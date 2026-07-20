import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { db } from "@/utils/db";
import { resolveExactRoleAssociations } from "@/lib/storyboardAssetAssociations";
import { normalizeProjectType, ProjectTypes } from "@/constants/project";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    scope: z.enum(["all", "project", "script"]),
    projectId: z.number().int().positive().optional(),
    scriptId: z.number().int().positive().optional(),
  }),
  async (req, res) => {
    try {
      const { scope, projectId, scriptId } = req.body as { scope: "all" | "project" | "script"; projectId?: number; scriptId?: number };
      if (scope !== "all" && !projectId) throw new Error("按项目或剧本体检时必须提供 projectId");
      if (scope === "script" && !scriptId) throw new Error("按剧本体检时必须提供 scriptId");

      const query = db("o_storyboard")
        .leftJoin("o_project", "o_project.id", "o_storyboard.projectId")
        .leftJoin("o_script", "o_script.id", "o_storyboard.scriptId")
        .select(
          "o_storyboard.id",
          "o_storyboard.projectId",
          "o_storyboard.scriptId",
          "o_storyboard.index",
          "o_storyboard.prompt",
          "o_storyboard.videoDesc",
          "o_project.name as projectName",
          "o_project.projectType",
          "o_script.name as scriptName",
        )
        .orderBy("o_storyboard.projectId")
        .orderBy("o_storyboard.scriptId")
        .orderBy("o_storyboard.index");
      if (projectId) query.where("o_storyboard.projectId", projectId);
      if (scriptId) query.where("o_storyboard.scriptId", scriptId);
      const storyboards = (await query).filter(
        (item) => normalizeProjectType(String(item.projectType ?? "")) === ProjectTypes.storyboard,
      );
      const storyboardIds = storyboards.map((item) => Number(item.id));
      const relations = storyboardIds.length
        ? await db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).select("storyboardId", "assetId")
        : [];
      const relationMap = new Map<number, Set<number>>();
      relations.forEach((row) => {
        const id = Number(row.storyboardId);
        const set = relationMap.get(id) ?? new Set<number>();
        set.add(Number(row.assetId));
        relationMap.set(id, set);
      });

      const items = [] as any[];
      let matchedCount = 0;
      let additionCount = 0;
      let excludedCount = 0;
      for (const storyboard of storyboards) {
        const storyboardId = Number(storyboard.id);
        const match = await resolveExactRoleAssociations(db, {
          storyboardId,
          projectId: Number(storyboard.projectId),
          scriptId: Number(storyboard.scriptId),
          prompt: storyboard.prompt,
          videoDesc: storyboard.videoDesc,
        });
        const current = relationMap.get(storyboardId) ?? new Set<number>();
        const additions = match.matched.filter((asset) => !current.has(Number(asset.id)));
        matchedCount += match.matched.length;
        additionCount += additions.length;
        excludedCount += match.excludedIds.size;
        if (!additions.length && !match.ambiguous.length && !match.excludedIds.size) continue;
        items.push({
          storyboardId,
          projectId: Number(storyboard.projectId),
          projectName: storyboard.projectName || `项目 ${storyboard.projectId}`,
          scriptId: Number(storyboard.scriptId),
          scriptName: storyboard.scriptName || `分镜表 ${storyboard.scriptId}`,
          index: storyboard.index,
          excerpt: String(storyboard.prompt || storyboard.videoDesc || "").slice(0, 180),
          matched: match.matched.map((asset) => ({ id: Number(asset.id), name: asset.name, imageId: asset.imageId ?? null })),
          additions: additions.map((asset) => ({ id: Number(asset.id), name: asset.name, imageId: asset.imageId ?? null })),
          excludedAssetIds: [...match.excludedIds],
          ambiguous: match.ambiguous,
        });
      }

      return res.status(200).send(
        success({
          summary: { storyboards: storyboards.length, matched: matchedCount, affected: items.filter((item) => item.additions.length).length, additions: additionCount, excluded: excludedCount },
          items,
        }),
      );
    } catch (e) {
      return res.status(400).send(error(e instanceof Error ? e.message : "关联体检失败"));
    }
  },
);

import express from "express";
import u from "@/utils";
import { z } from "zod";
import sharp from "sharp";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { Output } from "ai";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    assetIds: z.array(z.number()),
    projectId: z.number(),
    scriptId: z.number(),
    concurrentCount: z.number().min(1).optional(),
  }),
  async (req, res) => {
    const { assetIds, projectId, scriptId, concurrentCount = 5 } = req.body;

    const requestedAssetIds = [...new Set((assetIds as number[]).filter((id) => Number.isFinite(id)))];
    if (!requestedAssetIds.length) return res.status(400).send(error("assetIds不能为空"));

    const projectSettingData = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality", "artStyle").first();
    if (!projectSettingData) return res.status(400).send(error("未找到对应项目"));

    const script = await u.db("o_script").where({ id: scriptId, projectId }).first();
    if (!script) return res.status(400).send(error("未找到对应剧本"));

    const assetsDataArr = await u
      .db("o_assets")
      .join("o_scriptAssets", "o_assets.id", "o_scriptAssets.assetId")
      .where("o_assets.projectId", projectId)
      .where("o_scriptAssets.scriptId", scriptId)
      .whereIn("o_assets.id", requestedAssetIds)
      .whereNotNull("o_assets.assetsId")
      .select("o_assets.id", "o_assets.describe", "o_assets.name", "o_assets.type", "o_assets.assetsId", "o_assets.prompt");
    const validAssetIds = new Set(assetsDataArr.map((item) => item.id));
    if (validAssetIds.size !== requestedAssetIds.length) {
      return res.status(400).send(error("资产必须属于当前项目和剧本，且必须为衍生资产"));
    }

    const parentIds = [...new Set(assetsDataArr.map((item) => item.assetsId as number))];
    const parentAssetsData = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .where("o_assets.projectId", projectId)
      .whereIn("o_assets.id", parentIds)
      .select("o_assets.id", "o_image.filePath", "o_assets.describe");
    if (new Set(parentAssetsData.map((item) => item.id)).size !== parentIds.length) {
      return res.status(400).send(error("衍生资产的父资产不存在或不属于当前项目"));
    }
    assetsDataArr.forEach((i: any) => {
      const parent = parentAssetsData.find((item) => item.id === i.assetsId);
      if (parent) {
        i.parentDescribe = parent.describe;
      }
    });
    const imageUrlRecord: Record<number, string> = {};
    parentAssetsData.forEach((item) => {
      if (item.filePath) imageUrlRecord[item.id] = item.filePath;
    });
    const rolePrompt = u.getArtPrompt(projectSettingData!.artStyle!, "art_skills", "art_character_derivative");
    const toolPrompt = u.getArtPrompt(projectSettingData!.artStyle!, "art_skills", "art_prop_derivative");
    const scenePrompt = u.getArtPrompt(projectSettingData!.artStyle!, "art_skills", "art_scene_derivative");
    const promptRecord: Record<string, { prompt: string }> = {
      role: {
        prompt: rolePrompt,
      },
      tool: {
        prompt: toolPrompt,
      },
      scene: {
        prompt: scenePrompt,
      },
    };
    // 先批量为所有 assets 创建 image 记录并标记为"生成中"
    const imageIdMap: Record<number, number> = {};
    for (const item of assetsDataArr) {
      const [imageId] = await u.db("o_image").insert({
        assetsId: item.id,
        type: item.type,
        state: "生成中",
        resolution: projectSettingData?.imageQuality,
        model: projectSettingData?.imageModel,
      });
      imageIdMap[item.id!] = imageId;
      await u.db("o_assets").where("id", item.id).update({ imageId: imageId });
    }

    res.status(200).send(success("开始生成资产图片"));
    const generateSingleAsset = async (item: any) => {
      const imageId = imageIdMap[item.id!];
      try {
        let prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
        if (!prompt) {
          const typeConfig = promptRecord[item.type!] || promptRecord["role"];
          const { text } = await u.Ai.Text("universalAi").invoke({
            system: typeConfig.prompt,
            messages: [
              {
                role: "user",
                content: `
            父级资产描述: ${item.parentDescribe || "无详细描述"}
            当前资产描述: ${item.describe || "无详细描述"}`,
              },
            ],
          });
          prompt = text.trim();
          if (!prompt) throw new Error("资产提示词生成结果为空");
          await u.db("o_assets").where({ id: item.id, projectId }).update({ prompt });
        }

        const parentImagePath = imageUrlRecord[item.assetsId!];
        const imageBase64 = parentImagePath ? await u.oss.getImageBase64(parentImagePath) : null;
        const repeloadObj = {
          prompt,
          size: projectSettingData.imageQuality as "1K" | "2K" | "4K",
          aspectRatio: "16:9" as `${number}:${number}`,
        };
        const imageCls = await u.Ai.Image(projectSettingData.imageModel as `${string}:${string}`).run(
          {
            referenceList: imageBase64 ? [{ type: "image", base64: imageBase64 }] : [],
            ...repeloadObj,
          },
          {
            taskClass: "生成图片",
            describe: "资产图片生成",
            relatedObjects: JSON.stringify(repeloadObj),
            projectId,
          },
        );
        const savePath = `/${projectId}/assets/${scriptId}/${item.type}/${u.uuid()}.jpg`;
        await imageCls.save(savePath);
        await u.db("o_image").where({ id: imageId }).update({ state: "已完成", filePath: savePath, errorReason: null });
      } catch (e) {
        const errorReason = u.error(e).message;
        try {
          await u.db("o_image").where({ id: imageId }).update({ state: "生成失败", errorReason });
        } catch (updateError) {
          console.error(`资产 ${item.id} 生成失败状态写入失败`, updateError);
        }
      }
    };

    // 按 concurrentCount 分批并发执行
    for (let i = 0; i < assetsDataArr.length; i += concurrentCount) {
      const batch = assetsDataArr.slice(i, i + concurrentCount);
      await Promise.all(batch.map(generateSingleAsset));
    }
  },
);

import express from "express";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { error, success } from "@/lib/responseFormat";
import { getLatestStepRuns, getOrCreateRedrawSource, parseJson, redrawDb, requireRedrawProject } from "@/lib/redrawCommon";
import { redrawTargetStyleSchema } from "@/constants/redraw";
import u from "@/utils";

const router = express.Router();
export default router.post("/", validateFields({ projectId: z.number().int().positive() }), async (req, res) => {
  try {
    const project = await requireRedrawProject(req.body.projectId);
    const source = await getOrCreateRedrawSource(project.id);
    const [shots, segments, references, outputs, steps, agents, assets, storyboards] = await Promise.all([
      redrawDb("o_redrawShot").where("projectId", project.id).orderBy("shotIndex"),
      redrawDb("o_redrawSegment").where("projectId", project.id).orderBy(["startMs", "segmentIndex"]),
      redrawDb("o_redrawReference").where("projectId", project.id).orderBy("id"),
      redrawDb("o_redrawOutput").where("projectId", project.id).orderBy("id", "desc"),
      getLatestStepRuns(project.id),
      redrawDb("o_agentDeploy").where("key", "like", "redrawAgent%"),
      redrawDb("o_assets").where("projectId", project.id).orderBy("id"),
      redrawDb("o_storyboard").where("projectId", project.id).orderBy("index"),
    ]);
    const addUrl = async (row: any) => ({ ...row, url: row.filePath ? await u.oss.getFileUrl(row.filePath) : null });
    const images = assets.length ? await redrawDb("o_image").whereIn("id", assets.map((item: any) => item.imageId).filter(Boolean)) : [];
    const imageMap = new Map<number, any>(images.map((item: any) => [item.id, item]));
    const videos = segments.length ? await redrawDb("o_video").whereIn("id", segments.map((item: any) => item.videoId).filter(Boolean)) : [];
    const videoMap = new Map<number, any>(videos.map((item: any) => [item.id, item]));
    res.status(200).send(
      success({
        project,
        source: { ...source, targetStyle: redrawTargetStyleSchema.parse(parseJson(source.targetStyle, {})), url: source.filePath ? await u.oss.getFileUrl(source.filePath) : null },
        shots: shots.map((shot: any) => ({ ...shot, characters: parseJson(shot.characters, []), assetClues: parseJson(shot.assetClues, []), keyframes: parseJson(shot.keyframes, []) })),
        segments: await Promise.all(segments.map(async (segment: any) => {
          const video = videoMap.get(segment.videoId);
          return { ...segment, sourceUrl: segment.sourceClipPath ? await u.oss.getFileUrl(segment.sourceClipPath) : null, videoUrl: video?.filePath ? await u.oss.getFileUrl(video.filePath) : null };
        })),
        references: await Promise.all(references.map(addUrl)),
        outputs: await Promise.all(outputs.map(async (output: any) => ({ ...await addUrl(output), srtUrl: output.srtPath ? await u.oss.getFileUrl(output.srtPath) : null }))),
        steps,
        agents,
        assets: await Promise.all(assets.map(async (asset: any) => {
          const image = imageMap.get(asset.imageId) as any;
          return { ...asset, image: image ? await addUrl(image) : null };
        })),
        storyboards: await Promise.all(storyboards.map(addUrl)),
      }),
    );
  } catch (cause) {
    res.status(400).send(error(u.error(cause).message));
  }
});

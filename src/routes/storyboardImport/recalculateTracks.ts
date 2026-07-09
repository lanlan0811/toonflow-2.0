type StoryboardTrackRow = {
  id: number;
  track?: string | null;
  duration?: string | number | null;
  trackId?: number | null;
};

type VideoTrackRow = {
  id: number;
};

export async function recalculateStoryboardTracks(db: any, projectId: number, scriptIds: number[]) {
  const uniqueScriptIds = [...new Set(scriptIds.filter((id) => Number.isFinite(id)))];
  let trackIndex = 0;

  for (const scriptId of uniqueScriptIds) {
    const existingTracks = (await db("o_videoTrack").where({ projectId, scriptId }).select("id")) as VideoTrackRow[];
    const storyboards = (await db("o_storyboard").where({ projectId, scriptId }).select("id", "track", "duration", "trackId")) as StoryboardTrackRow[];
    if (!storyboards.length) {
      await db("o_videoTrack").where({ projectId, scriptId }).delete();
      continue;
    }

    const groups = storyboards.reduce((result: Record<string, StoryboardTrackRow[]>, item: StoryboardTrackRow) => {
      const track = item.track || "默认分组";
      if (!result[track]) result[track] = [];
      result[track].push(item);
      return result;
    }, {});

    const usedTrackIds: number[] = [];
    for (const track in groups) {
      const items = groups[track] ?? [];
      const trackDuration = items.reduce((sum: number, item: StoryboardTrackRow) => sum + Number(item.duration ?? 0), 0);
      const existingTrackId = items.find((item: StoryboardTrackRow) => item.trackId)?.trackId;
      const trackId = existingTrackId ?? Date.now() + trackIndex++;
      if (existingTrackId) {
        await db("o_videoTrack").where("id", trackId).update({ duration: trackDuration });
      } else {
        await db("o_videoTrack").insert({ id: trackId, scriptId, projectId, duration: trackDuration });
      }
      usedTrackIds.push(trackId);
      await db("o_storyboard")
        .whereIn(
          "id",
          items.map((item: StoryboardTrackRow) => item.id),
        )
        .update({ trackId });
    }

    const allTrackIds = existingTracks.map((item: VideoTrackRow) => item.id).filter((id: number) => Number.isFinite(id));
    const orphanTrackIds = allTrackIds.filter((trackId: number) => !usedTrackIds.includes(trackId));
    if (orphanTrackIds.length) await db("o_videoTrack").whereIn("id", orphanTrackIds).delete();
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import knexFactory from "knex";
import {
  ensureExactRoleAssociations,
  findExactRoleMatches,
  resolveExactRoleAssociations,
  storyboardRoleText,
} from "../../src/lib/storyboardAssetAssociations";

const roles = [
  { id: 1, name: "墨秋霜", type: "role" },
  { id: 2, name: "夏浅浅", type: "role" },
  { id: 3, name: "南宫离", type: "role" },
  { id: 4, name: "红衣三师妹", type: "role" },
  { id: 5, name: "三师妹", type: "role" },
  { id: 6, name: "墨秋霜的石台", type: "tool" },
];

test("matches complete role names across prompt and video description", () => {
  const text = storyboardRoleText("墨秋霜与夏浅浅站在石台上", "南宫离和红衣三师妹在旁等待");
  const result = findExactRoleMatches(text, roles);

  assert.deepEqual(
    result.matched.map((item) => item.id),
    [1, 2, 3, 4],
  );
});

test("prefers the longest role name at an overlapping occurrence", () => {
  const result = findExactRoleMatches("红衣三师妹走进画面", roles);

  assert.deepEqual(result.matched.map((item) => item.id), [4]);
});

test("does not infer aliases, titles, pronouns, or non-role assets", () => {
  const result = findExactRoleMatches("她与师妹站在墨秋霜的石台旁", roles);

  assert.deepEqual(result.matched.map((item) => item.id), [1]);
});

test("reports same-name ambiguity and does not auto-match it", () => {
  const result = findExactRoleMatches("阿青看向镜头", [
    { id: 11, name: "阿青", type: "role" },
    { id: 12, name: "阿青", type: "role" },
  ]);

  assert.deepEqual(result.matched, []);
  assert.deepEqual(result.ambiguous, [{ name: "阿青", assetIds: [11, 12] }]);
});

test("returns every asset at most once and is repeatable", () => {
  const text = "墨秋霜走近墨秋霜，夏浅浅回头看夏浅浅";
  const first = findExactRoleMatches(text, roles).matched.map((item) => item.id);
  const second = findExactRoleMatches(text, roles).matched.map((item) => item.id);

  assert.deepEqual(first, [1, 2]);
  assert.deepEqual(second, first);
});

test("isolates roles by script, respects exclusions, and inserts idempotently", async (t) => {
  const knex = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(async () => knex.destroy());
  await knex.schema.createTable("o_project", (table) => {
    table.integer("id").primary();
    table.string("projectType").notNullable();
  });
  await knex.schema.createTable("o_assets", (table) => {
    table.integer("id").primary();
    table.integer("projectId").notNullable();
    table.string("name").notNullable();
    table.string("type").notNullable();
    table.integer("imageId");
    table.integer("revision").notNullable().defaultTo(1);
  });
  await knex.schema.createTable("o_scriptAssets", (table) => {
    table.integer("scriptId").notNullable();
    table.integer("assetId").notNullable();
  });
  await knex.schema.createTable("o_storyboardAssetExclusion", (table) => {
    table.integer("storyboardId").notNullable();
    table.integer("assetId").notNullable();
    table.primary(["storyboardId", "assetId"]);
  });
  await knex.schema.createTable("o_assets2Storyboard", (table) => {
    table.integer("storyboardId").notNullable();
    table.integer("assetId").notNullable();
    table.integer("assetRevision").notNullable().defaultTo(1);
    table.integer("referenceEnabled").notNullable().defaultTo(1);
    table.primary(["storyboardId", "assetId"]);
  });
  await knex("o_assets").insert([
    { id: 1, projectId: 10, name: "墨秋霜", type: "role", revision: 3 },
    { id: 2, projectId: 10, name: "夏浅浅", type: "role", revision: 2 },
    { id: 3, projectId: 10, name: "南宫离", type: "role", revision: 7 },
    { id: 4, projectId: 11, name: "红衣三师妹", type: "role", revision: 1 },
  ]);
  await knex("o_project").insert([
    { id: 10, projectType: "storyboard" },
    { id: 11, projectType: "script" },
  ]);
  await knex("o_scriptAssets").insert([
    { scriptId: 20, assetId: 1 },
    { scriptId: 20, assetId: 2 },
    { scriptId: 21, assetId: 3 },
    { scriptId: 20, assetId: 4 },
  ]);
  await knex("o_storyboardAssetExclusion").insert({ storyboardId: 30, assetId: 2 });

  const resolved = await resolveExactRoleAssociations(knex, {
    storyboardId: 30,
    projectId: 10,
    scriptId: 20,
    prompt: "墨秋霜、夏浅浅和南宫离同框",
  });
  assert.deepEqual(resolved.matched.map((item) => item.id), [1]);
  assert.deepEqual([...resolved.excludedIds], [2]);

  const input = { storyboardId: 30, projectId: 10, scriptId: 20, prompt: "墨秋霜与夏浅浅" };
  assert.equal((await ensureExactRoleAssociations(knex, input)).added, 1);
  assert.equal((await ensureExactRoleAssociations(knex, input)).added, 0);
  assert.deepEqual(
    await knex("o_assets2Storyboard").orderBy("assetId").select("storyboardId", "assetId", "assetRevision", "referenceEnabled"),
    [{ storyboardId: 30, assetId: 1, assetRevision: 3, referenceEnabled: 1 }],
  );
  assert.equal(
    (await ensureExactRoleAssociations(knex, {
      storyboardId: 31,
      projectId: 11,
      scriptId: 20,
      prompt: "红衣三师妹",
    })).added,
    0,
  );
});

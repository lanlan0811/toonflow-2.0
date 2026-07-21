import type { Knex } from "knex";

async function createIfMissing(knex: Knex, name: string, builder: (table: Knex.CreateTableBuilder) => void) {
  if (!(await knex.schema.hasTable(name))) await knex.schema.createTable(name, builder);
}

export default async function ensureInfiniteCanvasSchema(knex: Knex) {
  await createIfMissing(knex, "o_infiniteCanvasWorkspace", (table) => {
    table.integer("projectId").notNullable().primary();
    table.integer("scriptId").notNullable();
    table.text("settingsData").notNullable();
    table.text("graphData").notNullable();
    table.integer("revision").notNullable().defaultTo(1);
    table.integer("createTime").notNullable();
    table.integer("updateTime").notNullable();
  });

  await createIfMissing(knex, "o_infiniteCanvasArtifact", (table) => {
    table.increments("id");
    table.integer("projectId").notNullable();
    table.string("nodeId").notNullable();
    table.string("origin").notNullable();
    table.string("mediaType").notNullable();
    table.text("fileName");
    table.text("mimeType");
    table.text("filePath");
    table.integer("videoId");
    table.integer("version").notNullable().defaultTo(1);
    table.integer("isCurrent").notNullable().defaultTo(1);
    table.integer("detached").notNullable().defaultTo(0);
    table.string("state").notNullable().defaultTo("generating");
    table.text("prompt");
    table.text("model");
    table.text("params");
    table.text("inputSignature");
    table.text("inputArtifactIds");
    table.text("errorReason");
    table.integer("createTime").notNullable();
    table.integer("updateTime").notNullable();
    table.index(["projectId", "nodeId", "version"]);
    table.index(["projectId", "state", "id"]);
    table.index(["videoId"]);
  });
}

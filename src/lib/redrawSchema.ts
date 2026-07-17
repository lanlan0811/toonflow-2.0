import type { Knex } from "knex";
import { redrawAgentConfigs } from "@/constants/redraw";

export const redrawTableSchemas = [
  {
    name: "o_redrawSource",
    builder: (table: Knex.CreateTableBuilder) => {
      table.increments("id");
      table.integer("projectId").notNullable().unique();
      table.text("filePath");
      table.text("originalName");
      table.string("mimeType");
      table.integer("size");
      table.string("sha256");
      table.integer("durationMs");
      table.integer("width");
      table.integer("height");
      table.float("fps");
      table.boolean("hasAudio").defaultTo(false);
      table.boolean("hasSubtitle").defaultTo(false);
      table.text("mediaMetadata");
      table.text("sourceStyle");
      table.text("targetStyle");
      table.string("analysisState").defaultTo("pending");
      table.text("errorReason");
      table.integer("scriptId");
      table.boolean("confirmed").defaultTo(false);
      table.integer("createTime").notNullable();
      table.integer("updateTime").notNullable();
      table.index(["projectId", "analysisState"]);
    },
  },
  {
    name: "o_redrawShot",
    builder: (table: Knex.CreateTableBuilder) => {
      table.increments("id");
      table.integer("projectId").notNullable();
      table.integer("sourceId").notNullable();
      table.integer("shotIndex").notNullable();
      table.integer("startMs").notNullable();
      table.integer("endMs").notNullable();
      table.text("scene");
      table.text("characters");
      table.text("actions");
      table.text("emotion");
      table.text("camera");
      table.text("dialogue");
      table.text("sound");
      table.text("assetClues");
      table.text("keyframes");
      table.boolean("confirmed").defaultTo(false);
      table.integer("createTime").notNullable();
      table.integer("updateTime").notNullable();
      table.unique(["sourceId", "shotIndex"]);
      table.index(["projectId", "sourceId", "shotIndex"]);
    },
  },
  {
    name: "o_redrawSegment",
    builder: (table: Knex.CreateTableBuilder) => {
      table.increments("id");
      table.integer("projectId").notNullable();
      table.integer("sourceId").notNullable();
      table.integer("shotId").notNullable();
      table.integer("segmentIndex").notNullable();
      table.integer("startMs").notNullable();
      table.integer("endMs").notNullable();
      table.integer("generationDurationMs");
      table.text("sourceClipPath");
      table.integer("storyboardId");
      table.integer("trackId");
      table.integer("videoId");
      table.string("state").defaultTo("pending");
      table.float("fidelityScore");
      table.text("fidelityReport");
      table.integer("retryCount").defaultTo(0);
      table.boolean("accepted").defaultTo(false);
      table.text("errorReason");
      table.integer("createTime").notNullable();
      table.integer("updateTime").notNullable();
      table.unique(["shotId", "segmentIndex"]);
      table.index(["projectId", "sourceId", "state"]);
    },
  },
  {
    name: "o_redrawReference",
    builder: (table: Knex.CreateTableBuilder) => {
      table.increments("id");
      table.integer("projectId").notNullable();
      table.integer("sourceId");
      table.integer("assetId");
      table.string("kind").notNullable();
      table.text("label");
      table.text("filePath").notNullable();
      table.integer("createTime").notNullable();
      table.index(["projectId", "sourceId", "assetId"]);
    },
  },
  {
    name: "o_redrawOutput",
    builder: (table: Knex.CreateTableBuilder) => {
      table.increments("id");
      table.integer("projectId").notNullable();
      table.integer("sourceId").notNullable();
      table.text("filePath");
      table.text("srtPath");
      table.string("state").defaultTo("pending");
      table.text("metrics");
      table.text("qualityReport");
      table.text("errorReason");
      table.integer("createTime").notNullable();
      table.integer("updateTime").notNullable();
      table.index(["projectId", "sourceId", "id"]);
    },
  },
] as const;

export async function ensureRedrawTables(knex: Knex) {
  for (const schema of redrawTableSchemas) {
    if (!(await knex.schema.hasTable(schema.name))) {
      await knex.schema.createTable(schema.name, schema.builder);
    }
  }
}

export async function ensureRedrawAgentConfigs(knex: Knex) {
  for (const agent of redrawAgentConfigs) {
    const existing = await knex("o_agentDeploy").where("key", agent.key).first();
    if (existing) continue;
    await knex("o_agentDeploy").insert({
      model: "",
      modelName: "",
      vendorId: null,
      key: agent.key,
      name: agent.name,
      desc: agent.desc,
      temperature: 1,
      maxOutputTokens: 0,
      disabled: false,
    });
  }
}

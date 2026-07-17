import express, { type Request, type Response } from "express";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";

export type ProductFactoryHandler = (req: Request, res: Response) => Promise<unknown>;

export function createProductFactoryRoute(handler: ProductFactoryHandler) {
  const router = express.Router();
  return router.post("/", async (req, res) => {
    try {
      const result = await handler(req, res);
      if (!res.headersSent) res.status(200).send(success(result ?? null));
    } catch (caught) {
      if (!res.headersSent) res.status(400).send(error(u.error(caught).message || "请求失败"));
    }
  });
}

export function requiredId(value: unknown, label: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label}无效`);
  return id;
}

export function idList(value: unknown, label = "ID") {
  if (!Array.isArray(value)) throw new Error(`${label}列表无效`);
  return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

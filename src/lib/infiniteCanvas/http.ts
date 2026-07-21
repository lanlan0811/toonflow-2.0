import express, { type Request, type Response } from "express";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";

export type InfiniteCanvasHandler = (req: Request, res: Response) => Promise<unknown>;

export function createInfiniteCanvasRoute(handler: InfiniteCanvasHandler) {
  const router = express.Router();
  return router.post("/", async (req, res) => {
    try {
      const result = await handler(req, res);
      if (!res.headersSent) res.status(200).send(success(result ?? null));
    } catch (caught: any) {
      const status = Number(caught?.statusCode) || 400;
      if (!res.headersSent) res.status(status).send(error(u.error(caught).message || "请求失败", null, status));
    }
  });
}

export function requiredId(value: unknown, label: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label}无效`);
  return id;
}

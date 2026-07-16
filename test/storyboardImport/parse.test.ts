import assert from "node:assert/strict";
import test from "node:test";
import { parseStoryboardImportContent } from "../../src/routes/storyboardImport/parse";

const markdown = `# 防诈骗公益短剧分镜表

| 镜号 | 时长 | 景别 | 镜头运动 | 场景 | 画面内容 | 台词/旁白 | 音效/配乐 | 道具/陈设 | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 4s | 特写 | 慢推 | 小区公园长椅旁 | 张阿姨和李姐坐在长椅旁 | 李姐：大姐，想不想学点神功？ | 轻微悬疑音效 | 邪教宣传传单（淡黄色纸张） | 开场 |
| 2 | 8s | 中景 | 固定 | 小区公园长椅 | 小明走向长椅 | 小明：奶奶！ | 环境音 | 公园长椅、手提袋（李姐的） |  |
| 3 | 3s | 全景 | 固定 | 家中客厅 | 张阿姨回到家 |  |  | 茶几 |  |
| 4 | 3s | 近景 | 固定 | 社区服务中心 | 工作人员递上宣传资料 |  |  | 宣传资料 |  |
| 5 | 3s | 全景 | 固定 | 片尾画面 | 防诈骗字幕出现 | 旁白：请相信科学。 |  |  |  |

## 角色形象参考

| 角色 | 年龄 | 外貌特征 | 服装 | 性格关键词 |
|---|---|---|---|---|
| 张阿姨 | 60岁 | 花白短发 | 深色外套 | 善良 |
| 李姐 | 50岁 | 短发 | 浅色外套 | 热情 |
| 小明 | 30岁 | 戴眼镜 | 休闲装 | 理性 |
| 社区工作人员 | 30岁 | 干练 | 工作服 | 负责 |

## 场景美术参考

### 场景1：小区公园
- 时间：白天
- 色调：明亮
- 元素：草地、树木、公园长椅
- 氛围：日常

### 场景2：家中客厅
- 时间：傍晚
- 色调：暖色
- 元素：沙发、茶几
- 氛围：温馨

### 场景3：社区服务中心
- 时间：白天
- 色调：明亮
- 元素：宣传栏
- 氛围：正式

---
`;

const text = `一、分镜明细
镜号：1
时长：4秒
景别：特写
镜头运动：慢推
场景：小区公园长椅旁
画面内容：张阿姨和李姐坐在长椅旁
台词/旁白：李姐：大姐，想不想学点神功？
道具/陈设：邪教宣传传单（淡黄色纸张）

镜号：2
时长：8秒
景别：中景
镜头运动：固定
场景：小区公园长椅
画面内容：小明走向长椅
台词/旁白：小明：奶奶！
道具/陈设：公园长椅、手提袋（李姐的）

镜号：3
时长：3秒
场景：家中客厅
画面内容：张阿姨回到家
道具/陈设：茶几

镜号：4
时长：3秒
场景：社区服务中心
画面内容：工作人员递上宣传资料
道具/陈设：宣传资料

镜号：5
时长：3秒
场景：片尾画面
画面内容：防诈骗字幕出现
台词/旁白：旁白：请相信科学。

二、角色形象参考
角色：张阿姨
年龄：60岁
角色：李姐
年龄：50岁
角色：小明
年龄：30岁
角色：社区工作人员
年龄：30岁

三、场景美术参考
场景1：小区公园
时间：白天
场景2：家中客厅
时间：傍晚
场景3：社区服务中心
时间：白天

四、音乐音效总览

六、字幕制作说明
`;

async function assertParsedResult(format: "markdown" | "txt-standard", content: string) {
  const parsed = await parseStoryboardImportContent({ format, content });

  assert.deepEqual(parsed.meta.assetStats, { roles: 3, scenes: 4, tools: 5, total: 12 });
  assert.deepEqual(parsed.data[0].sceneNames, ["小区公园"]);
  assert.deepEqual(parsed.data[0].toolNames, ["邪教宣传传单", "公园长椅"]);
  assert.match(parsed.warnings.join("\n"), /社区工作人员/);
  assert.match(parsed.warnings.join("\n"), /片尾画面/);
}

test("markdown uses effective assets and associates tools across rows", async () => {
  await assertParsedResult("markdown", markdown);
});

test("standard text uses the same asset post-processing", async () => {
  await assertParsedResult("txt-standard", text);
});

test("uses only the longest matching scene reference", async () => {
  const parsed = await parseStoryboardImportContent({
    format: "markdown",
    content: `# 嵌套场景\n\n| 镜号 | 时长 | 场景 | 画面内容 |\n|---|---|---|---|\n| 1 | 3s | 小区公园长椅旁 | 人物坐下 |\n\n## 场景美术参考\n\n### 场景1：公园\n- 氛围：普通\n\n### 场景2：小区公园\n- 氛围：日常\n\n---`,
  });

  assert.deepEqual(parsed.data[0].sceneNames, ["小区公园"]);
  assert.equal(parsed.meta.assetStats?.scenes, 1);
});

test("json counts row-level roles and scenes without reference metadata", async () => {
  const parsed = await parseStoryboardImportContent({
    format: "json",
    content: JSON.stringify([
      {
        prompt: "角色进入公园",
        videoDesc: "角色进入公园",
        duration: 3,
        track: "公园",
        roleNames: ["角色甲"],
        sceneNames: ["公园"],
        toolNames: ["长椅"],
      },
    ]),
  });

  assert.deepEqual(parsed.meta.assetStats, { roles: 1, scenes: 1, tools: 1, total: 3 });
});

test("csv counts row-level roles and scenes without reference metadata", async () => {
  const parsed = await parseStoryboardImportContent({
    format: "csv",
    content: "画面内容,时长,场景,角色,道具\n角色进入公园,3,公园,角色甲,长椅",
  });

  assert.deepEqual(parsed.meta.assetStats, { roles: 1, scenes: 1, tools: 1, total: 3 });
});

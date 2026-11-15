# 谎言公司

一款用真实证据来推进的全球舆论策略游戏。像素风，约 10 分钟一局。

[在线开一局](https://lies-company.zray.cc/) · [看看游戏介绍](https://lies-company.zray.cc/#intro)

![谎言公司游戏介绍：让真相，传播到全世界。](docs/introduction.webp)

## 游戏介绍

2077 年，一家企业靠传闻与流言统治世界。你将化身侦探，沿着线索找证据，再把它们传播到全世界。

玩法借鉴《瘟疫公司》，搜证与经营同步进行：

- **铺开传播网**：从一个地区起步，让六洲媒体接力转载。小红书成了小绿书，X 变成 Z，连“已读乱回”都会改变战局。传播让人看见，说服让人相信。
- **沿线找证据**：传播赚金币，金币用来调查。你选择线索，Agent 调用元宝搜索，带回可以打开来源、核对原文的材料，再沿新发现继续追查。
- **决定何时出手**：证据可以马上公布，也可以收入囊中。公布带来支持，也引来更强的反扑；用行动点升级能力、主动澄清，守住已经争取到的支持。

但就算全世界都相信了，那就真的是对的吗？

模拟支持率达到 99%，你赢得了传播战。Agent 还会复核实际公布过的证据，看看结局究竟是真相战胜了谎言，还是屠龙勇者终成龙。

## 运行说明

需要 **Node.js 22+**，使用 PC 浏览器游玩。

```sh
git clone https://github.com/zhaor1995/lies-company.git
cd lies-company
npm --prefix src ci
cp src/.env.example src/.env.local
```

打开 `src/.env.local`，填写搜索与模型服务配置：

| 服务 | 必填配置 |
| --- | --- |
| 腾讯云元宝搜索 | `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY` |
| 调查模型 | `MODEL_BASE_URL`（含 `/v1`）、`MODEL_API_KEY`、`MODEL_NAME` |

模型需支持严格工具调用的 Chat Completions 兼容接口。配置完成后，在项目根目录启动：

```sh
npm run dev
```

打开 [http://localhost:4173/](http://localhost:4173/) 即可游玩，无需构建。可在配置中修改 `PORT`；密钥只由服务端读取，配置文件已被 Git 忽略。

完整玩法、部署与测试说明见 [项目说明](src/README.md)。

项目使用 [MIT 许可证](LICENSE)。字体、音乐及第三方代码保留各自许可证，见 `src/dist/assets/` 与 `src/dist/vendor/`。

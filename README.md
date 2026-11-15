# 谎言公司

以证据调查、媒体传播与舆论对抗为核心的网页策略游戏。

游戏入口：[https://lies-company.zray.cc](https://lies-company.zray.cc/)。

正式代码位于 `src/`，本地运行、配置与玩法说明见 [开发文档](src/README.md)。

```sh
git clone https://github.com/zhaor1995/lies-company.git
cd lies-company
npm --prefix src ci
cp src/.env.example src/.env.local
# 填写 src/.env.local 中的搜索与模型服务配置
npm run dev
```

默认打开 http://localhost:4173/ ，可在 `src/.env.local` 中用 `PORT=4173` 修改端口；根目录和 `src/` 内都可运行 `npm run dev`。重复启动会自动停止占用指定端口的进程并重新启动。密钥仅保存在本地，不提交至仓库。

需要 Node.js 22+。前端、服务端和测试位于 `src/`，部署配置位于 `deploy/`，游戏直接由 Node 服务提供，无需构建。

项目使用 [MIT 许可证](LICENSE)。字体、音乐及第三方代码保留各自许可证，见 `src/dist/assets/` 与 `src/dist/vendor/`。

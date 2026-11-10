# 中文起飞台 · 10 个最小 MVP

一个完全本地运行的普通话学习微工具套件。它不是完整课程，而是把海外学习者反复出现的十类失败点做成可点击、可记录、可验证的最小产品。

## 运行

```bash
cd /path/to/Mandarin-Launchpad-MVPs
python3 -m http.server 4173
```

浏览器打开 `http://127.0.0.1:4173/`。

## 验收测试

无需安装依赖的语法检查与逻辑回归测试：

```bash
npm run check
npm run test:unit
```

逻辑测试使用 Node.js 内置测试工具和事件模拟，覆盖路由清理、表单空格输入、正常保存、汉字释义判断，以及录音授权延迟、连续点击、启动/停止失败、旧回调隔离、切题/离页释放、空录音、回放失败与过期语音取消。所有媒体接口均使用模拟实现，不会访问真实麦克风或外部接口；测试不验证浏览器 DOM、排版或设备兼容性。

浏览器复验还需检查：等待麦克风授权时离开并返回页面、录音时自动切题、录音完成后的连续回放、授权拒绝后重试，以及离开页面后麦克风指示灯和语音播放是否停止。单元测试通过不能代替这些设备检查。

浏览器测试另需 Playwright 与 Chromium，并需先在另一个终端启动上面的 HTTP 服务，再执行 `npm test`。默认使用 Playwright 的 Chromium；可通过 `CHROME_PATH` 显式指定其他浏览器。测试覆盖 11 个路由、10 个产品完成路径、错误输入、数据重载持久化、桌面/移动溢出、控制台与网络失败。

项目已包含依赖锁文件和 Playwright 开发依赖。全新环境先安装固定依赖和对应 Chromium：

```bash
npm ci --registry=https://registry.npmjs.org
npx --registry=https://registry.npmjs.org playwright install chromium
```

不要把历史 `qa/smoke-results.json` 当作本轮验收结果。

## 包含的 10 个产品

1. Flow Decoder — 调速、分块、听写与逐层揭示。
2. Tone Mirror — 声调轮廓、辨音、录音和回放。
3. Talk Rehearsal — 真实场景的限时表达排练。
4. Fixbook — 把真实纠错变成可回忆的个人错误库。
5. Sentence Forge — 中文句块重排与结构解释。
6. Hanzi Hooks — 部件、易混字与主动回忆。
7. Content Bridge — 把用户自己的文本切成可读层级。
8. Context Cards — 从真实句子生成完形复习卡。
9. Next 15 — 根据短板生成 15 分钟训练。
10. Proof of Progress — 记录能力证据而不是空 streak。

## 数据与隐私

- 所有学习记录只写入浏览器 `localStorage`。
- 录音只保留在当前浏览器内存；刷新页面即消失。
- 不上传文本、音频或学习记录。
- 语音播放使用浏览器本机的 `speechSynthesis` 中文语音；不同系统效果不同。

## 证据边界

研究与排序见 [report-source.md](./report-source.md)。Reddit 完整评论树受访问策略限制，本项目只把搜索索引中的公开标题/摘要当作发现信号；Chinese-Forums、Stack Exchange 与应用页面提供可直接读取的补充证据。排序尚未验证支付意愿。

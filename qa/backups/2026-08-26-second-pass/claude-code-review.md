# Claude Code CLI 审校与优化记录

日期：2026-08-26  
CLI：Claude Code 2.1.245  
权限：只读 `Read/Grep/Glob`；明确禁用 `Bash/Edit/Write`  
实际后端 telemetry：`qwen3.8-max`（本机路由覆盖了命令行请求的 `sonnet`，因此不能称为 Anthropic Claude 模型审校）

## 审校结论

审校确认 10 个产品均为可交互、可持久化的微产品，不是静态概念卡；同时发现若干会误导学习反馈或破坏跨路由状态的问题。

## 已落实

1. Hanzi Hooks 不再接受单字母或任意子串为正确答案。
2. Flow Decoder 首次听写前隐藏句块与拼音，分两层揭示。
3. Tone / Sentence 延迟切题计时器可取消，并验证不会覆盖新路由。
4. Skip link 与未知 hash 不再把产品页重绘为首页。
5. 没有中文系统语音时停止播放并明确报错，不用英文语音冒充。
6. 没有到期 Context Card 时不显示评分按钮，也不改写 SRS 间隔。
7. Tone 3 轮廓改为下降后回升的折线形状。
8. 离开 Tone Mirror 时停止录音与麦克风流。
9. Content Bridge 拒绝纯非中文输入，并移除旧 Safari 不支持的正则 lookbehind。
10. 主要动态中文内容补充 `lang="zh-CN"`，句子结果增加 `aria-live`。
11. Talk Rehearsal 切换场景时清理旧计时器。
12. Proof of Progress 显示全部五类能力，而不是只显示三类。
13. smoke test 增加错误答案、听写防泄题、Skip link、延迟路由、非中文文本、SRS 非到期态和重载持久化测试。
14. 增加 `package.json` 与测试运行说明；浏览器路径可通过 `CHROME_PATH` 覆盖。

## 保留为产品验证，不冒充代码已解决

- Talk Rehearsal 仍是自评，必须用真人通话验证迁移效果。
- Next 15 目前每类只有一套静态闭环，先验证启动率再扩内容。
- 浏览器 TTS 只用于 MVP 交互探针，生产测试必须换成学习者选择的真人原生音频。
- “完成”只表示试用过该工具，不表示语言能力掌握。

## 机器复验

见 `smoke-results.json`：11 路由、10 产品完成路径、1440×1000 与 390×844、零控制台问题、零失败请求，状态为 `PASS`。


# 第二包上手说明（定时发送）

这包做了什么：
- 中间发送区新增“定时发送”按钮
- 可把文字 / 图片排进定时发送队列
- 到点后自动发出去
- 支持取消未发送的任务
- 已排队任务会显示在聊天输入区下方

## 你需要替换的文件
按最终交付清单替换即可。

## 你需要新增的环境变量
Vercel 里新增：
- `CRON_SECRET`：你自己随便生成一串长一点的随机字符串

## GitHub 里要加的 Secrets
如果你的仓库在 GitHub，把这两个仓库 Secret 加进去：
- `APP_BASE_URL`：你的正式域名，比如 `https://xxx.vercel.app`
- `CRON_SECRET`：和 Vercel 里那串保持一致

## 为什么要 GitHub
因为你现在 Vercel Hobby 免费计划没法每 30 分钟自己跑一次 cron。
GitHub 在这里不是替你发消息，只是每 30 分钟敲一下你线上接口，真正发送还是你自己的 Vercel 项目去发。

## 上线顺序
1. 替换文件
2. 执行 Prisma migration / generate
3. 把 `CRON_SECRET` 加到 Vercel
4. 把 `.github/workflows/dispatch-scheduled-messages.yml` 推到 GitHub 默认分支
5. 在 GitHub 仓库里加 `APP_BASE_URL` 和 `CRON_SECRET`
6. 等部署完成后，可以在 GitHub Actions 里手动点一次 `workflow_dispatch` 测试

## 最低行为规则
- 定时发送至少要比当前时间晚 30 分钟
- GitHub 这条免费闹钟不是分钟级绝对精确，允许有少量延迟
- 但到点附近会自动扫并发送，不需要你一直开着后台

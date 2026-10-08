# 测试夹具

`release-gate-f60b50a.cjs` 是原仓库提交 `f60b50a256282faa67bb046ab302a178b7ef6a60` 中 `scripts/check-release-gates.cjs` 的历史实现，保留旧门禁能被仅含汇总的输入绕过的反例。

仅供测试，不能用于发布放行。由当前 `check-release-gates.test.cjs` 同时验证旧实现接受、新实现拒绝同一合成输入。保存本地夹具使源码 ZIP 和浅克隆不依赖旧 Git 对象；不得通过跳过此测试掩盖回归。

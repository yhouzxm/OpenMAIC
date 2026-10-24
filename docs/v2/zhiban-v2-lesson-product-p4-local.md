# 公式与采用入口收尾、P4 讲义同步（LOCAL）

2026-10-20，沿原 P6 收尾并进入 P4。分支 `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；未提交、推送或触发 GitHub CI。

## 产品范围

生成讲义中的 LaTeX 现在经原生 hardened KaTeX 配置转为 MathML，再转成可编辑文字，保留分数、根式、上下标。未识别结构保留 `[LaTeX 原式]`；不插入生成 HTML，不读取元素自带 HTML、路径或资源。比较符号按现有文字合同转成全角；复杂公式、布局和讲解动作仍需教师审核，不声称恢复原生公式排版。重复场景标题去重。

采用成功后刷新受限资源列表并直接打开对应草稿。当前有未保存修改时可取消切换，原输入保留，采用结果仍可通过后备链接打开。链接带 draft 目标，避免误打开已发布预览；每次仍由 API 核验任教及草稿权限。采用和发布保持两个明确操作。

P4 首包为**现有文本／PNG 讲义的同步翻页与重连**：教师上一页／下一页，学生默认跟随、可自主浏览和恢复跟随，显式重新同步，断网恢复与原生刷新重新核对当前课堂、授权和固定发布版本。前台每 5 秒读取现有受限课堂 API；不引入 WebSocket、原生 Runtime 或第二套播放器。离线暂留已读页；撤权、任务结束、换版或资源失效后清空当前预览并要求重新进入。已传到浏览器的内容不可能被离线撤回。

## 数据与授权边界

仅新增 `classroom/0003_classroom_presentation.sql`，在派发表增加页码、独立 presentation revision 和更新时间。翻页不增加课堂 session revision，不会让学生 Enter 的正常并发产生无关冲突。教师命令检查正常课程授权、课堂开放窗口、ACTIVE LECTURE、发布目录与精确版本、可信发布页数，并以独立 revision CAS；相同命令 key 幂等重放仍重查当前授权／课堂／版本。任务与 session 锁串行化结束和翻页，现有课程／Identity 屏障保留。

ACL 只增三列 UPDATE，继承现有租户 RLS。启动 readiness 核对三份独立 classroom migration checksum 与精确列 ACL；不在 web 启动时安装。该 migration 只用于本轮新建 owned disposable PG16，未修改或重放已应用 migrations。翻页不写 Attempt、完成、成绩或可信学习事件。

## 本地验证

定向公式／命令边界单元检查及 `tsconfig.build.json` 类型检查通过。新 helper、命令解析、专项执行器与受影响 JS 的定向 ESLint 通过；既有 content-client／classroom transaction 的宽泛 `any` lint 债务仍在，未把全文件 ESLint 声称全绿。

专项旅程已覆盖自动打开、未保存取消保留、后备链接、移动端无横向溢出；教师／学生／无关成员权限、实际页数上限、精确 ACL 变宽拒绝、独立 CAS／并发、撤权清屏、断网／刷新、撤回和换版／结束后的命令重放拒绝。最终范围由 [LOCAL receipt](evidence/zhiban-lesson-product-local.json) 和 [P4 旅程](evidence/lesson-product/presentation-journey.json) 标识；owned PG16 在专项结束后停止并清理。没有运行全仓或 GitHub 回归。

## 证据边界

- [原始真实输出引用](evidence/lesson-product/real-reference.json)来自此前真实 run；[离线公式投影](evidence/lesson-product/real-formula-projection.json)核对原三页／三公式。没有重新调用模型，也没有重写此前发布或真实模型 receipt。
- 专项命令 `pnpm verify:zhiban:lesson-product` 使用新建 owned PG16、真实授权／发布 API 和浏览器；生成完成状态仅在专项隔离环境注入、明确 FIXTURE，不能当作真实供应商证明。
- 本轮结果与截图另存 `evidence/lesson-product/`；先前真实模型、Storage／Identity／Bridge 证据仅保留各自适用范围。
- 停止旧默认实例前另做[三库备份](evidence/lesson-product/before-backup.json)及 owner-only 原文副本；dump 已核验 TOC，未执行恢复演练。新实例不是旧数据恢复，凭据不进入公共证据。

## 默认 3461 交付

默认入口已重建并保持运行，`trial:zhiban:info` 核对 `sourceMatches=true / sourceDriftCount=0`。新建课堂“P4 欧姆定律同步课堂”通过普通教师 API 创建、编排和发布；三页内容复用已备份真实 run 的离线文字投影，明确为新课堂副本，没有注入完成 run，也不是旧库恢复。详见[当前演示地址](evidence/lesson-product/default-demo.json)。模型配置沿用本机私有 wrapper，但本轮没有模型请求。

内置浏览器实际点击教师“下一页讲义”，显示 2/3；切换正常学生账号后自动跟随到第 2 页，例题保留 `I=(U) / (R)=(12 V) / (6 Ω)=2 A`。浏览器保留在该学生页面。[教师截图](evidence/lesson-product/default-teacher.png)、[学生截图](evidence/lesson-product/default-student.png)记录实际页面。当前合成课堂另做[三库备份](evidence/lesson-product/default-backup.json)，同样只验证 TOC，未声称恢复成功。

[冻结源核对](evidence/lesson-product/frozen-source-check.json)确认此前 28 份 migration、16 份冻结 Identity 文件 hash 均未改变。所有新增运行／截图均 LOCAL，无提交、推送或 CI。

完整 Native 场景 host／可信学习完成／Interactive／VirtualLab 尚未交付，Runtime、Bridge 和维护 deferred gates 不因本轮同步而启用。下一完整包是固定发布版本的原生只读场景播放接入，先核对公开宿主合同并复用上游；可信完成与需要真实 provider 的能力单独满足原门禁。建议 GPT-6.1 Sol / medium；涉及跨 Identity 授权和并发协议时用 high。

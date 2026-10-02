# dsh-model-seat

替换对话输入框右下角的模型选择器：

- **触发器**自带一层比输入框更亮的底色（暗色主题下更亮、亮色主题下更深，随主题前景色 mix），最前面是当前模型品牌的 logo；
- 弹出面板按提供方分组列出模型，**每一项前面是品牌 logo、下方是一行简短中文说明**；
- 说明文字被裁成一行，**鼠标悬浮该行任意位置都会完整显示**；
- 弹窗顶部是一个**搜索框**：打开即聚焦，边打边筛（匹配模型名 / 模型 id / 提供方 id / 提供方名），`Esc` 先清空再关闭，`↑`/`↓` 从搜索框直接跳进列表；
- 推理等级从列表改成**离散滑块**：拖动预览、松手提交，且**没有最高档的发光/流光/脉冲效果**；
- **选模型和调档在一次开门内完成**：点模型立即生效但**面板不关闭**，滑块随即切到该模型的档位可以接着调；关闭面板只是关闭，不应用任何东西。
- 填充色是一条**固定在整条轨道上的青→紫渐变**（最低档青蓝 `#38bdf8` → 最高档紫 `#a855f7`），由填充长度揭示当前档位。

它注册在 `conversation.input.model` 位（priority `-1000`，遮蔽内置模型位），但复用**同一份会话级模型目录**，因此与 `/model` 命令共享状态、互相同步。

## 安装与元数据

本插件以**标准组合包**方式安装：登记在 profile 的 `dsh.profile.bundles` 里（因此会出现在侧边栏「插件」页并可启停），profile 的 `cordis.patch.yml` 只保留一条 `disabled` 覆盖项——**不要再往那里加 `insert`**，因为顶层 insert 是直接 push 且不去重的，会和组合包自带的 patch 产生两条同 id 条目。

插件在插件列表里的标题与简介来自 `locale/zh.json` 与 `locale/en.json` 的 `meta` 字段（宿主 `readPluginMeta` 按当前语言选择，缺失时才回退到 `package.json` 的 `name`/`description`）。因此 `package.json` 必须导出这些资源：

```json
"exports": { "./locale/*.json": "./locale/*.json" }
```

改完元数据可用 `node tools/meta-check.cjs` 复现宿主的解析结果，确认 `title`/`description` 的中英映射。

### 客户端注入

`conversation.input.model` 的组件会收到框架的「会话标准工具包」share，其中会触达 `remote.session`。因此模块必须声明：

```js
inject: ['slots', 'locale', 'modelDirectories', 'sessions', 'remote', 'remote.session']
```

并且 `package.json` 的 `dsh.client.inject` 要包含 `@deepseek-ai/dsh-api-remotes` 与 `@deepseek-ai/dsh-api-session-controller`（保证这两个服务先于本插件就绪）。漏掉任何一处都会让 slot 条目在渲染时抛 `cannot get property "remote.session" without inject` 并回退到内置模型位。

## 文件

| 路径 | 作用 |
| --- | --- |
| `src/client.template.js` | 唯一手写来源（组件、样式、品牌识别、模型简介） |
| `assets/logos/*.svg` | 品牌图标素材，文件名即品牌 id |
| `tools/build.mjs` | 把图标内联进 `client.js`（`/* @MODEL_LOGOS@ */` 占位符） |
| `tools/smoke.mjs` | 纯 Node 冒烟测试（自带迷你 React 渲染器） |
| `client.js` | **构建产物**：浏览器实际加载的文件，不要手改 |

```powershell
node tools/build.mjs   # 重新生成 client.js
node tools/smoke.mjs   # 品牌匹配 + 中文简介 + 渲染 + 滑块交互 + 几何/配色/发光断言
```

## 加一个品牌 logo

1. 把 SVG 丢进 `assets/logos/`（文件名任意大小写，构建时统一转小写）；
2. 在 `BRAND_RULES` 里加一条 `['品牌id', ['别名词', ...]]`；
3. `node tools/build.mjs && node tools/smoke.mjs`。

每个图标**保留自己的原生 viewBox**（例如 DeepSeek 是 `0 0 24 24`，GLM 是 `0 0 64 64`），不必预先裁成统一尺寸。图标统一用 `currentColor` 填色，跟随主题明暗。

品牌匹配顺序：先按**提供方 id** 的 token 命中，再按**模型 id**，最后做长度 ≥4 的长词包含匹配；都认不出时回退成中性四角星。

## 模型下方那一行中文说明

按以下优先级取一条，写死单行、超出省略：

1. `MODEL_NOTES` —— 精确到模型 id 的中文短句（内置两个 DeepSeek 模型即用官方描述的中文）；
2. 提供方自己写的**中文** `description`（自定义 provider 若配了中文说明，直接采用；英文会被忽略）；
3. `ROLE_NOTES` —— 按模型 id 的 **token** 推导角色定位，例如 `flash` → 轻快版、`pro` → 增强版、`ultraspeed` → 极速版；
4. `DEFAULT_NOTE` —— `标准版，能力与成本均衡`。

也就是说：宿主只为自己那两个 DeepSeek 模型带了文案（且是英文），第三方模型一律没有描述元数据，这一行由插件自己生成——**用命名推导的定位，不编造具体能力参数**。

## 一次开门完成「选模型 + 调档」

交互规则只有一条：**改动即时生效，面板由你自己关**。

| 动作 | 行为 |
| --- | --- |
| 点模型行 | 立刻提交（档位沿用当前档位；新模型不支持该档位时回退到它的默认档，再退到中位档），**面板保持打开** |
| 拖 / 键盘调滑块 | 立刻提交，面板保持打开 |
| 点外部、`Esc`、再点触发器 | 纯关闭，**不产生任何额外提交** |

因为没有暂存态，就不存在「这次点击到底算不算数」的歧义：每一步在做的当下就已经落库，误点了马上在同一张卡片里改回来即可。

两个连带处理：

- 提交期间所有模型行暂时不可点（防止并发提交），但**外观保持不变**：这里用 `aria-disabled` 拦下交互，而不是原生的 `disabled` 属性——后者会让浏览器把按钮里的品牌图标和模型名一起变灰，看上去就像闪了一下（简介行自带颜色，所以当时不受影响）。因为行没有真正被禁用，焦点也不会掉出面板，`↑`/`↓` 导航自然不受影响；
- 换模型时如果新旧模型有同名档位，档位会**跟着带过去**，多数情况下点一下就够，不用再动滑块。

## 滑块几何

轨道比刻度区间**左右各外扩 13px**（即拇指半径 `TRACK_BLEED`），因此首尾刻度点和拇指都落在轨道内部，不会悬在轨道边缘外。填充条从轨道左边缘起、到当前刻度点中心止；渐变以 `background-size` 固定为整条轨道宽度，所以填充变长时是「揭示」渐变而不是压缩它。

弹窗宽度为 `min(275px, 100vw - 24px)`（原 324px 的 85%）。

## 搜索框

筛选按**分组**进行：某组只要有任一模型命中就保留，组内只显示命中的行；全都没有命中时显示「没有匹配的模型」。匹配范围是模型 id、模型名、提供方 id、提供方名四者的拼接串，因此 `glm`、`flash`、`zai` 这类输入都能快速收敛。搜索词是「每次打开独立」的——关闭弹窗即清空。

## 刷新不打扰列表

提交选择后宿主会重新发布目录，`status` 会短暂回到 `loading`。这时**不会**往列表里插入「正在刷新模型列表…」那一行——那会把每一行往下推、让整张卡片弹一下。

加载提示只出现在**列表确实没有任何内容**的时候（首次打开、目录为空），此时没有东西会被挤动；筛选状态下则由「没有匹配的模型」负责这类空列表的表达。

列表另外常驻 `scrollbar-gutter: stable`，这样内容高度在"需要滚动"的阈值附近来回时，滚动条的出现与消失不会让内容区宽度抖动。

## 外观设置（设置面板里的一页）

插件在设置导航里注册了一页「模型选择器外观」（`settings.section`），所有选项**改完即时生效**，并且和你正在用的模型位共用同一个数据源——调颜色时模型位会同步变化，不用保存后再去看。

| 分组 | 选项 | 字段 |
| --- | --- | --- |
| 对话输入框的模型位 | 显示模型图标 | `triggerLogo` |
| | 模型图标颜色（默认 `#ffffff`） | `triggerLogoColor` |
| | 背景色（默认 `#343436`） | `triggerTint` |
| | 背景不透明度（默认 100%） | `triggerOpacity` |
| | 模型名称颜色 | `triggerLabelColor` |
| | 推理等级颜色 | `triggerEffortColor` |
| 弹出面板 | 背景材质（无 / 透明 / 亚克力 / 云母） | `menuMaterial` |
| | 背景颜色（默认 `#343436`） | `menuTint` |
| | 背景不透明度（默认 92%） | `menuOpacity` |
| 模型列表 | 显示搜索框 | `showSearch` |
| | 显示模型图标 | `listLogo` |
| | 显示模型说明 | `listNote` |
| 推理等级滑块 | 启用渐变 | `sliderGradient` |
| | 单色 | `sliderSolid` |
| | 渐变起始色 / 结束色 | `sliderFrom` / `sliderTo` |

页面底部是**同一行**的两个按钮，都靠右：**恢复默认**在左、**保存**在右。两者样式一致，用颜色区分（保存是主题主色，恢复默认是警示色）。恢复默认**一次写入**清空以上全部覆盖（走 `{ kind: 'clear' }` 的 unset 路径），回到 schema 默认值与主题外观。

**字段联动**（控件会变成不可调节状态，而不是静默忽略）：

- `triggerLogoColor` 只在「显示模型图标」开启时可调。
- `menuOpacity` 只在材质为「无」或「透明」时可调；亚克力和云母自带固定强度。

### 材质与颜色是正交的

材质预设只负责 **backdrop-filter**（以及「透明」预设额外把底色清成 `transparent`）；`menuTint` + `menuOpacity` 负责**覆盖底色**。所以「亚克力 + 自定义颜色」这类组合能同时生效，而不是互相打架。面板底色是通过覆盖 MenuSurface 自己的两个自定义属性实现的：

```js
{ '--dsw-menu-surface-fill': menuFill, '--dsw-menu-backdrop-filter': material.filter }
```

### 值是怎么存下来的

宿主半侧（`index.js`）导出的 `Config` 里，每个字段都标了 `volatile()`——`dsh-settings` 会把这些字段投影成可编辑表单项，`dsh-client-ui-settings` 再通过 `ctx.configForms` 把已接受的值交给浏览器。写入走当前 profile 的 Cordis patch，因此**跨会话持久化**，重启后保留。

浏览器半侧用 primitives 的 `SettingsFormModel` 承载"宿主值 + 本地草稿"的合并：`field(name).text` 会带上草稿，所以拖动色板或滑块时模型位立刻跟着变；同一次手势再 `save()` 落库。设置服务不存在时（例如非 Web 组合）插件不会报错，而是退回 schema 默认值渲染。

### 注意：`node_modules/@deepseek-ai/schemastery`

本插件以 **junction（`link:`）方式安装**在 profile 里，Node 会把模块解析基准落到插件的**真实目录**，于是宿主半侧的 `import '@deepseek-ai/schemastery'` 向上查找时找不到 profile 的依赖。因此插件目录里放了一个 `node_modules/@deepseek-ai/schemastery` 链接指向 profile 中同一份包：

```powershell
New-Item -ItemType Junction -Path node_modules\@deepseek-ai\schemastery `
  -Target C:\Users\<user>\.dsh\profiles\<profile>\node_modules\@deepseek-ai\schemastery
```

正常通过 npm/pnpm 安装（非 `link:`）时不需要这一步，peer 依赖会自行解析。**删掉这个链接会让插件加载失败。**

### 两个必须遵守的约束（都是踩过的坑）

**1. `SettingsForm` 的 `onDiscard` 必须传。** 共享表单组件在卸载时会调用它：

```js
// packages/client/ui-primitives —— SettingsForm.js
const discard = useRef(props.onDiscard);
discard.current = props.onDiscard;
useEffect(() => () => { discard.current(); }, []);
```

漏传就是 `undefined()`。而这个页面渲染在 `sidebar.settings` 席位**内部**，异常会冒泡出去把整个设置入口打掉——侧边栏底部的设置行消失、面板再也打不开，只能重启应用。所以 `GuardedSettingsPanel` 外面包了一层错误边界，任何单页异常最多只牺牲这一页。

**2. `color-mix()` 的百分比槽里不要写 `calc()`。** 悬停高亮原本写成
`color-mix(in srgb, var(--tint) calc(var(--opacity) * 1.7), transparent)`，
整条声明不生效，表现为"悬浮没有高亮"。现在由脚本预先算好 `--dml-trigger-opacity-hover` 传进去。

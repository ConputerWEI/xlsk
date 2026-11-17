# 试吃音频来源总表

四道菜的音效已从"沿用其它项目的占位音频"换成**按菜名在互联网上检索、再按质地处理**的实录。

| 菜品 | 音频 | 来源（Freesound） | 作者 | 授权 |
| --- | --- | --- | --- | --- |
| 冬阴功虾汤 `tom-yum` | `Drinking Noisily the Broth` + `Slurping Soup` | [#556417](https://freesound.org/people/StePrince/sounds/556417/) · [#153528](https://freesound.org/people/Eakoontz/sounds/153528/) | StePrince / Eakoontz | CC0 |
| 炭烤沙嗲鸡串 `satay` | `Eating Juicy Meat.wav` | [#234237](https://freesound.org/people/ProductionNow/sounds/234237/) | ProductionNow | CC0 |
| 虾仁炒金边粉 `pad-thai` | `Man Eating Teriyaki Noodles.wav` | [#204114](https://freesound.org/people/marcjunker/sounds/204114/) | marcjunker | CC0 |
| 芒果椰浆糯米饭 `mango-rice` | `Watermelon Eating` | [#523704](https://freesound.org/people/KrypticKnight/sounds/523704/) | KrypticKnight | CC0 |

四个来源全部为 **CC0**，无需署名即可随项目分发；此处仍保留来源与作者记录。

## 检索思路

1. 先按**菜名**精确搜：`pad thai`、`tom yum`、`satay`、`mango sticky rice`。Freesound 上只有曼谷炒粉摊、泰拳馆之类的环境音，没有进食声。
2. 退回按**食材/动作名**搜：`eating soup`、`slurping soup`、`eating noodles`、`eating juicy meat`、`eating fruit`。这一步命中了可用的实录。
3. `sticky rice` / `glutinous` / `rice cake` 均无结果，糯米饭改用"吃水果"的实录做软糯化处理（见该目录 SOURCE.md）。

## 统一处理规格

- 单声道、44.1 kHz、MP3 96 kbps
- 峰值 ≤ **−2.5 dBFS**，RMS **−21 dBFS**（各段响度一致）
- 8 ms 淡入、80 ms 淡出，去掉切点爆音
- 每段都按菜品做过 **lowpass / lowshelf / equalizer**，让"汤像汤、肉像肉、面像面、糯米像糯米"
- 播放层的音量与低通仍由 `src/lib/sound.ts` 的 `biteProfiles` 控制（satay 2900 Hz、pad-thai 2600 Hz、mango-rice 1900 Hz、tom-yum 2300 Hz）

各目录 `SOURCE.md` 记录具体切点与处理参数。

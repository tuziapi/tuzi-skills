---
name: tuzi-copy-polish
description: 优化社交媒体文案，支持小红书、X/Twitter、抖音、微信等平台。根据平台特性调整文风、长度、标签和排版。当用户要求"优化文案"、"润色推文"、"改写小红书文案"、"polish copy"时使用。
---

# Social Copy Polish

Optimizes social media copy for different platforms. Adjusts tone, length, hashtags, and formatting based on platform best practices.

## Step 0: Load Preferences ⛔ BLOCKING

### 0.1 Check EXTEND.md

```bash
test -f .tuzi-skills/tuzi-copy-polish/EXTEND.md && echo "project"
test -f "$HOME/.tuzi-skills/tuzi-copy-polish/EXTEND.md" && echo "user"
```

| Result | Action |
|--------|--------|
| Found | Load, parse, apply settings |
| Not found | Continue with defaults (ask platform in Step 2) |

| Path | Location |
|------|----------|
| `.tuzi-skills/tuzi-copy-polish/EXTEND.md` | Project directory |
| `$HOME/.tuzi-skills/tuzi-copy-polish/EXTEND.md` | User home |

**EXTEND.md Supports**: Default platform | Default language | Custom brand voice

Schema: `references/config/preferences-schema.md`

## Step 1: Analyze Input

Read the user's draft copy. Identify:

- Content type (product promotion, knowledge sharing, personal story, news, opinion)
- Current language and tone
- Key message and selling points
- Target audience (if mentioned)

## Step 2: Confirm Platform

If platform not specified by user or EXTEND.md, use AskUserQuestion:

```yaml
header: "Target Platform"
question: "优化目标平台？"
options:
  - label: "小红书"
    description: "种草风、emoji、标签、口语化"
  - label: "X/Twitter"
    description: "简洁有力、英文友好、话题标签"
  - label: "抖音"
    description: "口语化、悬念开头、引导互动"
  - label: "微信公众号"
    description: "深度内容、段落清晰、引导关注"
  - label: "通用"
    description: "不针对特定平台，仅优化表达"
```

## Step 3: Polish Copy

Load platform rules from [references/platforms/](references/platforms/), then rewrite:

### Optimization Dimensions

| Dimension | Description |
|-----------|-------------|
| Hook | Opening line that grabs attention |
| Tone | Match platform culture (e.g., 小红书 casual, 公众号 professional) |
| Length | Trim or expand to platform sweet spot |
| Structure | Platform-specific formatting (line breaks, paragraphs, lists) |
| Hashtags | Add relevant tags per platform convention |
| CTA | Call-to-action matching platform interaction patterns |
| Emoji | Platform-appropriate emoji usage |

### Output Format

Present the polished copy in a code block for easy copying. Include:

1. Polished copy (ready to paste)
2. Brief changelog (what was changed and why, 2-3 bullet points)

If the original is significantly different from the polished version, show a before/after comparison.

### Multiple Variants

When the user asks for options, generate 2-3 variants with different angles:

- Variant A: Focus on emotion/story
- Variant B: Focus on value/benefit
- Variant C: Focus on curiosity/hook

## Step 4: Iterate

After presenting the polished copy, ask if the user wants to:
- Adjust tone (more casual / more professional)
- Try a different angle
- Optimize for another platform
- Fine-tune specific parts

## Extension Support

Custom configurations via EXTEND.md. See **Step 0** for paths and supported options.

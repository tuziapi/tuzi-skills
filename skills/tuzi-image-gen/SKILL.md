---
name: tuzi-image-gen
description: 通过兔子API（nano-banana 模型）、Google、OpenAI、DashScope 和 Replicate 进行 AI 图片生成。支持文生图、参考图片、宽高比、模型选择，以及 OpenAI 兼容网关方言切换。当用户要求生成、创建或绘制图片时使用。
---

# Image Generation (AI SDK)

Multi-provider image generation. Default provider: Tuzi (兔子API, api.tu-zi.com).

## Script Directory

**Agent Execution**:
1. `SKILL_DIR` = this SKILL.md file's directory
2. Script path = `${SKILL_DIR}/scripts/main.ts`

## Step 0: Load Preferences ⛔ BLOCKING

**CRITICAL**: This step MUST complete BEFORE any image generation. Do NOT skip or defer.

### 0.1 Check API Key

Check if the selected provider's API key is available. For Tuzi (default):

```bash
# Check env, then .tuzi-skills/.env files
echo "${TUZI_API_KEY:-not_set}"
grep -s TUZI_API_KEY .tuzi-skills/.env "$HOME/.tuzi-skills/.env"
```

| Result | Action |
|--------|--------|
| Key found | Continue to Step 0.2 |
| Key NOT found | ⛔ Run API key setup (see [references/config/first-time-setup.md](references/config/first-time-setup.md) → "API Key Setup") → Store key → Then continue |

**CRITICAL**: If API key is missing, MUST guide user to obtain and store it BEFORE any generation. Generation is BLOCKED until key is configured.

### 0.2 Check EXTEND.md

Check EXTEND.md existence (priority: project → user):

```bash
test -f .tuzi-skills/tuzi-image-gen/EXTEND.md && echo "project"
test -f "$HOME/.tuzi-skills/tuzi-image-gen/EXTEND.md" && echo "user"
```

| Result | Action |
|--------|--------|
| Found | Load, parse, apply settings. If `default_model.[provider]` is null → ask model only (Flow 2) |
| Not found | ⛔ Run first-time setup ([references/config/first-time-setup.md](references/config/first-time-setup.md)) → Save EXTEND.md → Then continue |

**CRITICAL**: If not found, complete the full setup (provider + model + quality + save location) using AskUserQuestion BEFORE generating any images. Generation is BLOCKED until EXTEND.md is created.

| Path | Location |
|------|----------|
| `.tuzi-skills/tuzi-image-gen/EXTEND.md` | Project directory |
| `$HOME/.tuzi-skills/tuzi-image-gen/EXTEND.md` | User home |

**EXTEND.md Supports**: Default provider | Default quality | Default aspect ratio | Default image size | OpenAI image API dialect | Default models

Schema: `references/config/preferences-schema.md`

## Usage

```bash
# Basic (uses Tuzi provider by default)
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A cat" --image cat.png

# With aspect ratio
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A landscape" --image out.png --ar 16:9

# With quality (Tuzi: 1k/2k/4k)
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A cat" --image out.png --quality 2k

# 4K VIP model
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A cat" --image out.png --model gemini-3-pro-image-preview-4k-vip

# With reference images
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "Make it blue" --image out.png --ref source.png

# From prompt files
npx -y bun ${SKILL_DIR}/scripts/main.ts --promptfiles system.md content.md --image out.png

# Async model (auto-polls)
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A cat" --image out.png --model gemini-3-pro-image-preview-2k-async

# Other providers
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A cat" --image out.png --provider google
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A cat" --image out.png --provider openai
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "一只可爱的猫" --image out.png --provider dashscope
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A cat" --image out.png --provider replicate

# OpenAI-compatible gateway dialect
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A cat" --image out.png --provider openai --imageApiDialect ratio-metadata
```

## Options

| Option | Description |
|--------|-------------|
| `--prompt <text>`, `-p` | Prompt text |
| `--promptfiles <files...>` | Read prompt from files (concatenated) |
| `--image <path>` | Output image path (required) |
| `--provider tuzi\|google\|openai\|dashscope\|replicate` | Force provider (default: auto-detect, Tuzi first) |
| `--model <id>`, `-m` | Model ID (see Tuzi Models section for full list) |
| `--ar <ratio>` | Aspect ratio (e.g., `16:9`, `1:1`, `4:3`). Tuzi converts to `NxN` format |
| `--size <WxH>` | Size override (e.g., `1024x1024`, `16x9`) |
| `--quality normal\|2k` | Quality preset. Tuzi: maps to 1k/2k. Google: maps to 1K/2K |
| `--imageSize 1K\|2K\|4K` | Image size (Tuzi and Google). Overrides `--quality` |
| `--imageApiDialect openai-native\|ratio-metadata` | OpenAI-compatible endpoint dialect. `ratio-metadata` is for gateways that expect aspect-ratio `size` plus `metadata.resolution` |
| `--ref <files...>` | Reference images. Tuzi: base64 in JSON body. Google: multimodal. OpenAI: edits API |
| `--n <count>` | Number of images |
| `--json` | JSON output |

## Tuzi Models

Tuzi API (api.tu-zi.com) is the default provider. Models differ in quality, speed, and supported parameters.

### Recommended

| Model ID | Alias | Quality | Notes |
|----------|-------|---------|-------|
| `gemini-3-pro-image-preview` | nano-banana-pro | `--quality` 1k/2k/4k | Default. High quality, supports quality param |
| `gemini-3.1-flash-image-preview` | nano-banana-2 | `--quality` 1k/2k/4k | Fast, supports extended aspect ratios |
| `gemini-3-pro-image-preview-vip` | nano-banana-pro-vip | 1k built-in | High quality, VIP |
| `gemini-3-pro-image-preview-2k-vip` | nano-banana-pro-2k-vip | 2k built-in | High quality 2K, VIP |
| `gemini-3-pro-image-preview-4k-vip` | nano-banana-pro-4k-vip | 4k built-in | High quality 4K, VIP |
| `gemini-2.5-flash-image-vip` | nano-banana-vip | 1k built-in | Fastest, VIP |

### More Models

| Model ID | Alias | Notes |
|----------|-------|-------|
| `gemini-3-pro-image-preview` | nano-banana-pro | `--quality` 1k/2k/4k |
| `gemini-2.5-flash-image` | nano-banana | Fast |
| `gemini-3-pro-image-preview-hd` | nano-banana-pro-hd | HD built-in |
| `gemini-3-pro-image-preview-2k` | nano-banana-pro-2k | 2K built-in |
| `gemini-3-pro-image-preview-4k` | nano-banana-pro-4k | 4K built-in |
| `gpt-image-2` | — | OpenAI latest image model, supports modern size rules |
| `gpt-image-1.5` | — | Size: 1:1, 3:2, 2:3 only |
| `bfl-flux-2-pro` | flux-2-pro | Flux |
| `bfl-flux-2-max` | flux-2-max | Flux highest quality |
| `flux-kontext-pro` | kontext-pro | Multi-ref editing |
| `flux-kontext-max` | kontext-max | Multi-ref editing (max) |
| `doubao-seedream-4-0-250828` | Seedream 4.0 | 2K/4K |
| `doubao-seedream-4-5-251128` | Seedream 4.5 | 2K/4K |
| `doubao-seedream-5-0-260128` | Seedream 5.0 lite | 2K/3K |

### Async Models

Auto-detected. Script submits task and polls until complete (5s interval, max 30min).

| Model ID | Notes |
|----------|-------|
| `gemini-3-pro-image-preview-async` | 1K async |
| `gemini-3-pro-image-preview-2k-async` | 2K async |
| `gemini-3-pro-image-preview-4k-async` | 4K async |
| `mj-imagine` | Midjourney, MJ params in prompt |

### Model-Specific Parameters

**Quality** (`--quality` or `--imageSize 1K|2K|4K`):

| Applies to | Values | Notes |
|------------|--------|-------|
| `gemini-3.1-flash-image-preview` | 1k / 2k / 4k | Default model, quality adjustable |
| `gemini-3-pro-image-preview` | 1k / 2k / 4k | Quality adjustable |
| `*-2k-vip`, `*-4k-vip`, `*-hd` | — | Quality built into model name, param ignored |
| Other models | — | Param ignored |

**Aspect ratio** (`--ar`):

| Applies to | Supported ratios |
|------------|-----------------|
| Gemini models (default) | 1:1, 16:9, 9:16, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 21:9 |
| `gemini-3.1-flash-image-preview` | Above + 1:4, 4:1, 1:8, 8:1 (extreme ratios) |
| `gpt-image-2` | Flexible ratio via generated valid pixel size; custom `--size` must satisfy OpenAI constraints |
| `gpt-image-1.5` | 1:1, 3:2, 2:3 |
| `doubao-seedream-*` | Use explicit `--size` / `--imageSize`; `--ar` alone is not supported |
| Omitted | Model auto-decides |

**Reference images** (`--ref`):
- `gpt-image-*`: OpenAI-style `/images/edits` multipart upload
- Other sync models: base64 data URL in JSON `image` field
- Async models: `input_reference` in FormData
- Most Tuzi sync models support reference images; `doubao-seedream-3-0-*` does not

**Seedream** (`doubao-seedream-*`):

| Applies to | Size rules | Reference images |
|------------|------------|------------------|
| `doubao-seedream-5-0-*` | `2K`, `3K`, or explicit `WxH` | Up to 14 |
| `doubao-seedream-4-5-*` | `2K`, `4K`, or explicit `WxH` | Up to 14 |
| `doubao-seedream-4-0-*` | `1K`, `2K`, `4K`, or explicit `WxH` | Up to 14 |
| `doubao-seedream-3-0-*` | Explicit `WxH` only | Not supported |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TUZI_API_KEY` | Tuzi API key (https://api.tu-zi.com) |
| `TUZI_IMAGE_MODEL` | Tuzi default model (default: gemini-3-pro-image-preview) |
| `TUZI_BASE_URL` | Custom Tuzi endpoint (default: https://api.tu-zi.com/v1) |
| `GOOGLE_API_KEY` | Google API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `DASHSCOPE_API_KEY` | DashScope API key (阿里云) |
| `REPLICATE_API_TOKEN` | Replicate API token |
| `GOOGLE_IMAGE_MODEL` | Google model override |
| `OPENAI_IMAGE_MODEL` | OpenAI model override (default: `gpt-image-2`) |
| `DASHSCOPE_IMAGE_MODEL` | DashScope model override |
| `REPLICATE_IMAGE_MODEL` | Replicate model override |
| `GOOGLE_BASE_URL` | Custom Google endpoint |
| `OPENAI_BASE_URL` | Custom OpenAI endpoint |
| `OPENAI_IMAGE_API_DIALECT` | OpenAI-compatible endpoint dialect (`openai-native` or `ratio-metadata`) |
| `DASHSCOPE_BASE_URL` | Custom DashScope endpoint |
| `REPLICATE_BASE_URL` | Custom Replicate endpoint |

**Load Priority**: CLI args > EXTEND.md > env vars > `<cwd>/.tuzi-skills/.env` > `~/.tuzi-skills/.env`

## Model Resolution

Priority (highest → lowest), all providers:

1. CLI: `--model <id>`
2. EXTEND.md: `default_model.[provider]`
3. Env var: `<PROVIDER>_IMAGE_MODEL`
4. Built-in default

**Agent MUST display model info** before each generation:
- Show: `Using [provider] / [model]`
- Show switch hint: `Switch model: --model <id> | EXTEND.md default_model.[provider] | env <PROVIDER>_IMAGE_MODEL`

## Provider Selection

1. `--provider` specified → use it
2. `--ref` provided + no `--provider` → Tuzi > Google > OpenAI > Replicate
3. Only one API key available → use that provider
4. Multiple available → Tuzi first

## OpenAI-Compatible Dialect

When `provider=openai`, the endpoint may still be an OpenAI-compatible gateway rather than native OpenAI infrastructure.

- `openai-native`: standard OpenAI Images API request body
- `ratio-metadata`: sends aspect-ratio `size` plus `metadata.resolution`, useful for compatibility gateways in front of non-native image backends

Current limitation: `ratio-metadata` is text-to-image only. When using `--ref`, stay on `openai-native`.

## Quality Presets

| Preset | Tuzi | Google | OpenAI |
|--------|------|--------|--------|
| `normal` | 1k | 1K | 1024px |
| `2k` (default) | 2k | 2K | 2048px |

`--imageSize 1K|2K|4K` overrides quality for Tuzi and Google.

## Generation Mode

**Default**: Sequential (one at a time).

**Parallel**: Only when user explicitly requests. Use Task tool with `run_in_background=true`, recommended 4 subagents (max 8).

## Error Handling

- Missing API key → ⛔ MUST run API key setup from Step 0.1 (guide user to https://api.tu-zi.com/token, store in .tuzi-skills/.env). Do NOT suggest GOOGLE_API_KEY or other provider keys unless user explicitly chose a different provider.
- Generation failure → auto-retry once
- Tuzi `PROHIBITED_CONTENT` → content rejection error
- Tuzi `NO_IMAGE` → prompt too vague, suggest more explicit prompt
- Async timeout → error after 30 minutes
- Invalid aspect ratio → warning, proceed with default

## Replicate Models

Format: `owner/name` or `owner/name:version`

```bash
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A cat" --image out.png --provider replicate
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A cat" --image out.png --provider replicate --model google/nano-banana-2 --ar 16:9
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A fashion photo" --image out.png --provider replicate --model bytedance/seedream-4.5 --size 4K
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A cinematic scene" --image out.png --provider replicate --model wan-video/wan-2.7-image-pro --size 4K
```

### Supported Families

| Family | Example models | Reference images | Aspect ratio | Size handling | Notes |
|--------|----------------|------------------|--------------|---------------|-------|
| Nano Banana | `google/nano-banana`, `google/nano-banana-pro`, `google/nano-banana-2` | Up to 14 | Standard documented ratios | `--quality` maps to 1K/2K, `--size` can infer ratio + 1K/2K | Best default compatibility |
| Seedream 4.5 | `bytedance/seedream-4.5` | Up to 14 | Standard documented ratios | `--size` supports `2K`, `4K`, or custom `WxH` | Good for high-resolution output |
| Seedream 5 Lite | `bytedance/seedream-5-lite` | Up to 14 | Standard documented ratios | `--size` supports `2K` or `3K` | Simpler size presets |
| Wan 2.7 Image | `wan-video/wan-2.7-image` | Up to 9 | `W:H` ratios converted into size | `--size` supports `1K`, `2K`, or custom `WxH` | Reference images use `images` field |
| Wan 2.7 Image Pro | `wan-video/wan-2.7-image-pro` | Up to 9 | `W:H` ratios converted into size | `--size` supports `1K`, `2K`, `4K`, or custom `WxH` | `4K` only for text-to-image (no `--ref`) |

### Replicate Notes

- Current tool saves exactly one image per request, so Replicate supports `--n 1` only.
- `--imageSize` is not used for Replicate. Use `--quality`, `--ar`, or `--size` instead.
- Unknown Replicate models still work for prompt-only generation, but `--ref`, `--ar`, and `--size` are only guaranteed for the families listed above.
- Documented aspect ratios shared by Nano Banana and Seedream in this tool: `1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9`.

## Extension Support

Custom configurations via EXTEND.md. See **Step 0** for paths and supported options.

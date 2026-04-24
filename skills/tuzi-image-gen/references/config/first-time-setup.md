---
name: first-time-setup
description: First-time setup and default model selection flow for tuzi-image-gen
---

# First-Time Setup

## Overview

Triggered when:
1. API key missing for selected provider → API key setup
2. No EXTEND.md found → full setup (provider + model + preferences)
3. EXTEND.md found but `default_model.[provider]` is null → model selection only

## API Key Setup

**Triggered when**: Provider's API key is not found in env, `.tuzi-skills/.env`, or `~/.tuzi-skills/.env`.

**Language**: Use user's input language or saved language preference.

### Step 1: Guide user to obtain API key

For Tuzi (default provider), display:

```
TUZI_API_KEY 未配置。请先获取 API Key：

1. 打开 https://api.tu-zi.com/token 创建并获取 API Key
2. 视频教程：https://www.bilibili.com/video/BV1k4PqzPEKz/
```

For other providers, display the corresponding key setup URL:
- Google: `GOOGLE_API_KEY` — https://aistudio.google.com/apikey
- OpenAI: `OPENAI_API_KEY` — https://platform.openai.com/api-keys
- DashScope: `DASHSCOPE_API_KEY` — https://dashscope.console.aliyun.com/apiKey
- Replicate: `REPLICATE_API_TOKEN` — https://replicate.com/account/api-tokens

### Step 2: Ask user for API key

**IMPORTANT**: Do NOT use AskUserQuestion for this step. Instead, directly ask the user in plain text to paste their API key. Example:

```
请粘贴你的 Tuzi API Key（以 sk- 开头）：
```

Wait for user to reply with the key string. Validate it starts with `sk-`.

### Step 3: Ask save location (if no .env exists yet)

```yaml
header: "Save Location"
question: "API Key 保存位置？"
options:
  - label: "Project (Recommended)"
    description: ".tuzi-skills/.env (仅当前项目)"
  - label: "User"
    description: "~/.tuzi-skills/.env (所有项目共享)"
```

### Step 4: Store API key

1. Create directory if needed: `mkdir -p <chosen-path>/.tuzi-skills`
2. Append key to `.env` file (do NOT overwrite existing content):
   ```bash
   echo "TUZI_API_KEY=<user-provided-key>" >> <chosen-path>/.tuzi-skills/.env
   ```
3. Confirm to user: "API Key 已保存到 `<full-path>/.tuzi-skills/.env`"
4. Set the key in current process env so generation can proceed immediately

### Provider-specific env var names

| Provider | Env Variable | Obtain URL |
|----------|-------------|------------|
| Tuzi | `TUZI_API_KEY` | https://api.tu-zi.com/token |
| Google | `GOOGLE_API_KEY` | https://aistudio.google.com/apikey |
| OpenAI | `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
| DashScope | `DASHSCOPE_API_KEY` | https://dashscope.console.aliyun.com/apiKey |
| Replicate | `REPLICATE_API_TOKEN` | https://replicate.com/account/api-tokens |

## Setup Flow

```
No EXTEND.md found          EXTEND.md found, model null
        │                            │
        ▼                            ▼
┌─────────────────────┐    ┌──────────────────────┐
│ AskUserQuestion     │    │ AskUserQuestion      │
│ (full setup)        │    │ (model only)         │
└─────────────────────┘    └──────────────────────┘
        │                            │
        ▼                            ▼
┌─────────────────────┐    ┌──────────────────────┐
│ Create EXTEND.md    │    │ Update EXTEND.md     │
└─────────────────────┘    └──────────────────────┘
        │                            │
        ▼                            ▼
    Continue                     Continue
```

## Flow 1: No EXTEND.md (Full Setup)

**Language**: Use user's input language or saved language preference.

Use AskUserQuestion with ALL questions in ONE call:

### Question 1: Default Provider

```yaml
header: "Provider"
question: "Default image generation provider?"
options:
  - label: "Tuzi (Recommended)"
    description: "兔子API - nano-banana models via api.tu-zi.com"
  - label: "Google"
    description: "Gemini multimodal - high quality, reference images, flexible sizes"
  - label: "OpenAI"
    description: "GPT Image - consistent quality, reliable output"
  - label: "DashScope"
    description: "Alibaba Cloud - z-image-turbo, good for Chinese content"
  - label: "Replicate"
    description: "Community models - nano-banana, Seedream, Wan"
```

### Question 2: Default Google Model

Only show if user selected Google or auto-detect (no explicit provider).

```yaml
header: "Google Model"
question: "Default Google image generation model?"
options:
  - label: "gemini-3-pro-image-preview (Recommended)"
    description: "Highest quality, best for production use"
  - label: "gemini-3.1-flash-image-preview"
    description: "Fast generation, good quality, lower cost"
  - label: "gemini-3-flash-preview"
    description: "Fast generation, balanced quality and speed"
```

### Question 3: Default Quality

```yaml
header: "Quality"
question: "Default image quality?"
options:
  - label: "2k (Recommended)"
    description: "2048px - covers, illustrations, infographics"
  - label: "normal"
    description: "1024px - quick previews, drafts"
```

### Question 4: Save Location

```yaml
header: "Save"
question: "Where to save preferences?"
options:
  - label: "Project (Recommended)"
    description: ".tuzi-skills/ (this project only)"
  - label: "User"
    description: "~/.tuzi-skills/ (all projects)"
```

### Save Locations

| Choice | Path | Scope |
|--------|------|-------|
| Project | `.tuzi-skills/tuzi-image-gen/EXTEND.md` | Current project |
| User | `$HOME/.tuzi-skills/tuzi-image-gen/EXTEND.md` | All projects |

### EXTEND.md Template

```yaml
---
version: 1
default_provider: [selected provider or null]
default_quality: [selected quality]
default_aspect_ratio: null
default_image_size: null
default_image_api_dialect: null
default_model:
  google: [selected google model or null]
  openai: null
  dashscope: null
  replicate: null
  tuzi: null
---
```

## Flow 2: EXTEND.md Exists, Model Null

When EXTEND.md exists but `default_model.[current_provider]` is null, ask ONLY the model question for the current provider.

### Google Model Selection

```yaml
header: "Google Model"
question: "Choose a default Google image generation model?"
options:
  - label: "gemini-3-pro-image-preview (Recommended)"
    description: "Highest quality, best for production use"
  - label: "gemini-3.1-flash-image-preview"
    description: "Fast generation, good quality, lower cost"
  - label: "gemini-3-flash-preview"
    description: "Fast generation, balanced quality and speed"
```

### OpenAI Model Selection

```yaml
header: "OpenAI Model"
question: "Choose a default OpenAI image generation model?"
options:
  - label: "gpt-image-2 (Recommended)"
    description: "Latest GPT Image model, supports newer size rules and better gateway compatibility"
  - label: "gpt-image-1.5"
    description: "Previous GPT Image generation model"
```

### DashScope Model Selection

```yaml
header: "DashScope Model"
question: "Choose a default DashScope image generation model?"
options:
  - label: "z-image-turbo (Recommended)"
    description: "Fast generation, good quality"
  - label: "z-image-ultra"
    description: "Higher quality, slower generation"
```

### Replicate Model Selection

```yaml
header: "Replicate Model"
question: "Choose a default Replicate image generation model?"
options:
  - label: "google/nano-banana-2 (Recommended)"
    description: "Newest Nano Banana family model on Replicate, strong general default"
  - label: "google/nano-banana-pro"
    description: "Stable Nano Banana Pro default, compatible with quality + aspect-ratio flow"
  - label: "google/nano-banana"
    description: "Google's base Nano Banana model on Replicate"
  - label: "bytedance/seedream-4.5"
    description: "High-resolution model, supports 2K/4K and custom WxH"
  - label: "bytedance/seedream-5-lite"
    description: "Seedream Lite model, supports 2K/3K"
  - label: "wan-video/wan-2.7-image-pro"
    description: "Wan image model with optional 4K text-to-image output"
```

### Tuzi Model Selection

```yaml
header: "Tuzi Model"
question: "Choose a default Tuzi image generation model?"
options:
  - label: "gemini-3-pro-image-preview (Recommended)"
    description: "nano-banana-pro - high quality, supports quality param (1k/2k/4k)"
  - label: "gemini-3.1-flash-image-preview"
    description: "nano-banana-2 - fast, supports quality param (1k/2k/4k), extended aspect ratios"
  - label: "gemini-3-pro-image-preview-vip"
    description: "nano-banana-pro-vip - high quality, VIP"
  - label: "gemini-3-pro-image-preview-2k-vip"
    description: "nano-banana-pro-2k-vip - 2K built-in, VIP"
  - label: "gemini-3-pro-image-preview-4k-vip"
    description: "nano-banana-pro-4k-vip - 4K built-in, VIP"
  - label: "gemini-3-pro-image-preview"
    description: "nano-banana-pro - supports quality param (1k/2k/4k)"
  - label: "gpt-image-2"
    description: "GPT Image model with newer size rules"
```

### Update EXTEND.md

After user selects a model:

1. Read existing EXTEND.md
2. If `default_model:` section exists → update the provider-specific key
3. If `default_model:` section missing → add the full section:

```yaml
default_model:
  google: [value or null]
  openai: [value or null]
  dashscope: [value or null]
  replicate: [value or null]
  tuzi: [value or null]
```

Only set the selected provider's model; leave others as their current value or null.

## After Setup

1. Create directory if needed
2. Write/update EXTEND.md with frontmatter
3. Confirm: "Preferences saved to [path]"
4. Continue with image generation

---
name: preferences-schema
description: EXTEND.md YAML schema for tuzi-short-video user preferences
---

# Preferences Schema

## Full Schema

```yaml
---
version: 1

default_platform: null     # xiaohongshu|douyin|x-twitter|weixin-video|null

default_model: null         # veo3|veo3.1|sora-2|null (null = veo3.1)
---
```

## Field Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `version` | int | 1 | Schema version |
| `default_platform` | string\|null | null | Default target platform |
| `default_model` | string\|null | null | Default video model |

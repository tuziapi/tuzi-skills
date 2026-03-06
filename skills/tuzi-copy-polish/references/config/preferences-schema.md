---
name: preferences-schema
description: EXTEND.md YAML schema for tuzi-copy-polish user preferences
---

# Preferences Schema

## Full Schema

```yaml
---
version: 1

default_platform: null     # xiaohongshu|x-twitter|douyin|weixin|null

default_language: null      # zh|en|null (null = auto-detect from input)

brand_voice: null           # Custom brand voice description (free text)
---
```

## Field Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `version` | int | 1 | Schema version |
| `default_platform` | string\|null | null | Default target platform |
| `default_language` | string\|null | null | Output language |
| `brand_voice` | string\|null | null | Custom brand voice/tone description |

## Examples

**Minimal**:
```yaml
---
version: 1
default_platform: xiaohongshu
---
```

**With brand voice**:
```yaml
---
version: 1
default_platform: x-twitter
default_language: en
brand_voice: "Professional but approachable. Use data-driven arguments. Avoid slang."
---
```

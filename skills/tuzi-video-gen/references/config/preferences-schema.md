---
name: preferences-schema
description: EXTEND.md YAML schema for tuzi-video-gen user preferences
---

# Preferences Schema

## Full Schema

```yaml
---
version: 1

default_model: null        # veo3|veo3.1|sora-2|sora-2-pro|kling-v1-6|seedance-1.5-pro|null

default_seconds: null      # "8"|"10"|"15"|null (null = model default)

default_size: null          # "1280x720"|"720x1280"|"1920x1080"|null (null = model default)
---
```

## Field Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `version` | int | 1 | Schema version |
| `default_model` | string\|null | null | Default video model (null = veo3.1) |
| `default_seconds` | string\|null | null | Default duration in seconds |
| `default_size` | string\|null | null | Default video size |

## Examples

**Minimal**:
```yaml
---
version: 1
default_model: veo3
---
```

**Full**:
```yaml
---
version: 1
default_model: veo3.1
default_seconds: "8"
default_size: "1280x720"
---
```

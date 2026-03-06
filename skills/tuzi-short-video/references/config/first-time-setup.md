---
name: first-time-setup
description: First-time setup flow for tuzi-short-video
---

# First-Time Setup

Same API key setup as tuzi-video-gen. See `skills/tuzi-video-gen/references/config/first-time-setup.md` for API key flow.

## EXTEND.md Setup

Use AskUserQuestion:

### Question 1: Default Platform

```yaml
header: "Platform"
question: "默认发布平台？"
options:
  - label: "小红书"
    description: "9:16 竖屏, 720x1280, 15-60s"
  - label: "抖音"
    description: "9:16 竖屏, 1080x1920, 15-60s"
  - label: "X/Twitter"
    description: "16:9 横屏, 1280x720, 5-140s"
  - label: "视频号"
    description: "9:16/16:9, 1080x1920, 15-60s"
```

### Question 2: Save Location

```yaml
header: "Save"
question: "偏好保存位置？"
options:
  - label: "Project (Recommended)"
    description: ".tuzi-skills/ (仅当前项目)"
  - label: "User"
    description: "~/.tuzi-skills/ (所有项目)"
```

### EXTEND.md Template

```yaml
---
version: 1
default_platform: null
default_model: null
---
```

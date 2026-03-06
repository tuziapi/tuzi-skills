---
name: single-video
description: 单视频生成工作流
---

# Single Video Workflow

## Flow

1. Analyze user input (text, article, script)
2. Determine platform preset (size, duration, aspect ratio)
3. Generate video prompt based on content
4. Call tuzi-video-gen to generate video
5. Report result

## Prompt Generation Guidelines

- Describe visual scenes, camera movements, lighting
- Include style keywords (cinematic, documentary, vlog, etc.)
- Specify mood and atmosphere
- Keep prompt under 500 words for best results
- For Chinese content, write prompts in English for better model understanding

## tuzi-video-gen Call

```bash
npx -y bun ${VIDEO_GEN_DIR}/scripts/main.ts \
  --promptfiles <prompt-file> \
  --video <output-path> \
  --model <model> \
  --size <platform-size> \
  --seconds <duration>
```

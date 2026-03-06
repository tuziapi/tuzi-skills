---
name: long-video
description: 长视频（多段合成）工作流
---

# Long Video Workflow

## Flow

1. Analyze content, determine total segments needed
2. Split content into logical segments (opening, body sections, ending)
3. Generate per-segment prompts with continuity notes
4. Call tuzi-video-gen with `--segments N --segment-prompts`
5. Report result

## Segment Planning

- Opening (1 segment): Hook, introduce topic
- Body (1-N segments): Main content, each segment covers one key point
- Ending (1 segment): Summary, call to action

## Continuity Tips

- tuzi-video-gen auto-extracts last frame for next segment reference
- Keep visual style consistent across prompts
- Mention recurring elements (characters, settings) in each prompt
- Transition hints: "continuing from previous scene..."

## tuzi-video-gen Call

```bash
npx -y bun ${VIDEO_GEN_DIR}/scripts/main.ts \
  --video <output-path> \
  --segments <N> \
  --segment-prompts seg1.md seg2.md seg3.md \
  --model <model> \
  --size <platform-size> \
  --seconds <per-segment-duration>
```

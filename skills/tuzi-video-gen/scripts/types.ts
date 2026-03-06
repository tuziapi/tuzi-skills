export type CliArgs = {
  prompt: string | null
  promptFiles: string[]
  videoPath: string | null
  model: string | null
  seconds: string | null
  size: string | null
  referenceImages: string[]
  refMode: "reference" | "frames" | "components" | null
  segments: number | null
  segmentPrompts: string[]
  json: boolean
  help: boolean
}

export type ExtendConfig = {
  version: number
  default_model: string | null
  default_seconds: string | null
  default_size: string | null
}

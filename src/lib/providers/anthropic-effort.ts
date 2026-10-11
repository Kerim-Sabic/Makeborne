import "server-only";
import {ReasoningIntensitySchema} from "../routing/effort";

// Explicit current provider capability evidence, not a model quality ranking.
// Unknown models or unsupported levels require qualification before dispatch.
const allLevels=new Set(["claude-opus-5-5","claude-opus-5","claude-opus-4-8","claude-opus-4-7",
  "claude-sonnet-5-5","claude-sonnet-5","claude-haiku-5-5","claude-fable-5-1","claude-fable-5"]);
const withoutXhigh=new Set(["claude-opus-4-6","claude-sonnet-4-6"]);
const threeLevels=new Set(["claude-opus-4-5","claude-opus-4-5-20251101"]);
export function resolveAnthropicEffort(model:string,intensity:unknown){
  const effort=ReasoningIntensitySchema.parse(intensity);
  if(!(allLevels.has(model)||withoutXhigh.has(model)&&effort!=="xhigh"||threeLevels.has(model)&&["low","medium","high"].includes(effort)))
    throw Object.assign(Error("ANTHROPIC_EFFORT_UNSUPPORTED"),{code:"ANTHROPIC_EFFORT_UNSUPPORTED"});
  return effort;
}

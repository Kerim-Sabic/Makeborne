import {z} from "zod";
import {ScopeSchema, ExactAmountSchema} from "../jobs/contracts";
export const GenerationSubmissionSchema = z.object({proposalId: z.string().uuid(), approvalHash: z.string().regex(/^[a-f0-9]{64}$/),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/), processingConsent: z.literal(true), externalProcessingConsent: z.boolean(),
  sourceRightsConfirmed: z.literal(true)}).strict();
export const GenerationConsentSchema = GenerationSubmissionSchema.pick({processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true});
export type GenerationConsent = z.infer<typeof GenerationConsentSchema>;
export const GenerationProgressSchema = z.object({id: z.string().uuid(), scope: ScopeSchema,
  state: z.enum(["queued","working","building","awaiting_review","ready","failed","cancelled","cancelling","needs_attention"]),
  revision: z.string().regex(/^[0-9]+:[0-9]+:(?:none|queued|running|compiled|failed|cancelled)$/),
  outputVersionId: z.string().uuid().nullable(), credits: z.object({maximum: ExactAmountSchema, reserved: ExactAmountSchema, charged: ExactAmountSchema}).strict().nullable(),
  createdAt: z.string().datetime({offset: true}), updatedAt: z.string().datetime({offset: true}), canCancel: z.boolean()}).strict();
export type GenerationProgress = z.infer<typeof GenerationProgressSchema>;
export const GenerationPreparationSchema = z.object({scope: ScopeSchema.extend({artifactId: z.string().uuid()}),
  baseVersionId: z.string().uuid(), sourceIds: z.array(z.string().uuid()).max(100),
  processingConsent: GenerationSubmissionSchema.shape.processingConsent,
  externalProcessingConsent: GenerationSubmissionSchema.shape.externalProcessingConsent,
  sourceRightsConfirmed: GenerationSubmissionSchema.shape.sourceRightsConfirmed}).strict().refine(
    value => new Set(value.sourceIds).size === value.sourceIds.length, "Source references must be unique.");
export const PreparedGenerationSchema = GenerationSubmissionSchema.pick({proposalId: true, approvalHash: true, inputHash: true})
  .extend({maximumCredits: ExactAmountSchema, expiresAt: z.string().datetime({offset: true})}).strict();

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, ExternalLink, ScanFace, ShieldCheck, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge, Button, Field, Input, Select } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { fmtPercent } from '@/lib/format';
import { QUALITY_REASON_TEXT } from '@/lib/imageQuality';
import type { EnrollImageResult, PersonDetail } from '@/lib/types';
import { EnrolledFaces } from './EnrolledFaces';
import { FaceCapture, type CapturedImage } from './FaceCapture';

const schema = z.object({
  legalBasis: z.enum(['CONSENT', 'EMPLOYMENT', 'LEGAL_OBLIGATION', 'LEGITIMATE_USE', 'OTHER']),
  consentReference: z.string().trim().min(3, 'Record the consent form / policy reference').max(255),
  consentConfirmed: z.boolean().refine((v) => v, 'Confirmation is required before biometric enrollment'),
  replaceExisting: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

const LEGAL_BASIS: Array<[FormValues['legalBasis'], string]> = [
  ['CONSENT', 'Explicit consent of the individual'],
  ['EMPLOYMENT', 'Employment-related purpose (documented)'],
  ['LEGAL_OBLIGATION', 'Compliance with a legal obligation'],
  ['LEGITIMATE_USE', 'Other legitimate use permitted by law'],
  ['OTHER', 'Other (documented in the reference)'],
];

type MatchedFace = { id: string; hasPhoto?: boolean; qualityScore?: number | null; createdAt?: string };

type DuplicateHit = {
  matchedPersonId?: string;
  matchedPersonName?: string;
  referenceId?: string;
  matchedTemplateId?: string;
  matchedImageIndex?: number;
  similarity?: number;
  matchedFaces?: MatchedFace[];
};

function parseDuplicate(err: ApiError): DuplicateHit {
  const d = err.details as DuplicateHit | undefined;
  const fromMessage = err.message.match(/\(([^)]+)\)/)?.[1]?.trim();
  return {
    matchedPersonId: d?.matchedPersonId,
    matchedPersonName: d?.matchedPersonName,
    referenceId: d?.referenceId ?? (fromMessage && fromMessage !== 'unknown reference' ? fromMessage : undefined),
    matchedTemplateId: d?.matchedTemplateId,
    matchedImageIndex: d?.matchedImageIndex,
    similarity: d?.similarity,
    matchedFaces: d?.matchedFaces,
  };
}

export function EnrollmentPanel({ person, onEnrolled }: { person: PersonDetail; onEnrolled: (p: PersonDetail) => void }) {
  const notify = useToast();
  const [images, setImages] = useState<CapturedImage[]>([]);
  const [results, setResults] = useState<EnrollImageResult[] | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateHit | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      legalBasis: person.legalBasis ?? 'CONSENT',
      consentReference: person.consentReference ?? '',
      consentConfirmed: false,
      replaceExisting: false,
    },
  });
  const consentReference = watch('consentReference');

  async function onSubmit(values: FormValues) {
    setServerError(null);
    setDuplicate(null);
    setResults(null);
    if (!images.length) {
      setServerError('Capture or upload at least one photo.');
      return;
    }
    if (images.some((img) => img.quality?.warnings.length)) {
      setServerError('Replace every photo that has a warning. A blurry, dark, or small enrollment is how one person later shows up under another name.');
      return;
    }
    const form = new FormData();
    images.forEach((img, i) => form.append('images', img.file, img.file.name || `image-${i}.jpg`));
    form.append('legalBasis', values.legalBasis);
    form.append('consentReference', values.consentReference);
    form.append('consentConfirmed', 'true');
    form.append('replaceExisting', String(values.replaceExisting));
    try {
      const { data } = await api.post<{ person: PersonDetail; results: EnrollImageResult[] }>(`/persons/${person.id}/enroll`, form);
      setResults(data.results);
      const accepted = data.results.filter((r) => r.accepted).length;
      notify('success', 'Face enrolled', `${accepted} template(s) stored for ${data.person.personName}.`);
      images.forEach((i) => URL.revokeObjectURL(i.url));
      setImages([]);
      onEnrolled(data.person);
    } catch (err) {
      if (err instanceof ApiError) {
        const d = err.details as { results?: EnrollImageResult[]; similarity?: number } | undefined;
        if (d?.results) setResults(d.results);
        if (err.code === 'DUPLICATE_IDENTITY') {
          setDuplicate(parseDuplicate(err));
          setServerError(err.message);
        } else if (err.code === 'INCONSISTENT_IDENTITY') {
          setServerError(`${err.message} (similarity ${d?.similarity ?? '—'}). Remove photos of other people and try again.`);
        } else if (err.code === 'AI_SERVICE_UNAVAILABLE') {
          setServerError('The recognition service is unavailable. No data was stored; try again shortly.');
        } else setServerError(err.message);
      } else setServerError('Enrollment failed');
    }
  }

  const inactive = person.status !== 'ACTIVE';
  const holdReason = person.status === 'SUSPENDED'
    ? 'This person is suspended and is not in recognition. Make them active before enrolling biometric data.'
    : 'This person is inactive and is not in recognition. Retrieve them to active before enrolling biometric data.';
  const consentLooksLikeOtherId =
    consentReference.trim().length >= 3 &&
    consentReference.trim().toLowerCase() !== person.referenceId.trim().toLowerCase();

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {inactive && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{holdReason}</p>}
      <div className="rounded-lg border border-ink-700 bg-ink-850/50 px-3 py-2 text-sm text-ink-200">
        <p>
          Enrolling face for <span className="font-medium text-ink-50">{person.personName}</span>
          {' · '}
          ID <span className="font-mono text-ink-50">{person.referenceId}</span>
        </p>
        <p className="mt-1 text-xs text-ink-400">
          Fill the oval in even light. The device checks quality first; the server only stores templates after pose and identity checks. Consent reference is paperwork only — it does not change whose face is stored.
        </p>
      </div>
      <FaceCapture images={images} onChange={setImages} />

      <div className="rounded-xl border border-ink-700 bg-ink-850/60 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-100">
          <ShieldCheck className="h-4 w-4 text-brand-400" /> Legal basis &amp; consent
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Legal basis" error={errors.legalBasis?.message}>
            <Select {...register('legalBasis')}>
              {LEGAL_BASIS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Consent / authorization reference" error={errors.consentReference?.message} hint="e.g. signed consent form number or HR policy ID — not the person ID">
            <Input placeholder="CONSENT-2026-0042" {...register('consentReference')} />
          </Field>
        </div>
        {consentLooksLikeOtherId && (
          <p className="mt-2 text-xs text-amber-200/90">
            Consent reference differs from this person&apos;s ID ({person.referenceId}). That is fine for paperwork, but the face will still be stored under {person.referenceId}.
          </p>
        )}
        <label className="mt-4 flex items-start gap-3 text-sm text-ink-200">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-600" {...register('consentConfirmed')} />
          <span>
            I confirm that a valid legal basis exists for processing this person&apos;s facial biometric data, that the individual has been informed of the purpose and retention, and that the reference above is on record (Digital Personal Data Protection Act, 2023 and applicable law).
          </span>
        </label>
        {errors.consentConfirmed && <p className="mt-1 text-xs text-red-400">{errors.consentConfirmed.message}</p>}
        {person.templateCount > 0 && (
          <label className="mt-3 flex items-center gap-3 text-sm text-ink-200">
            <input type="checkbox" className="h-4 w-4 accent-blue-600" {...register('replaceExisting')} />
            Replace the {person.templateCount} existing template(s) instead of adding to them
          </label>
        )}
      </div>

      {serverError && (
        <div className="space-y-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm text-red-200" role="alert">
          <p>{serverError}</p>
          {duplicate && (
            <div className="space-y-2 rounded-md border border-red-500/20 bg-ink-950/40 px-3 py-2 text-ink-200">
              <p className="text-xs font-medium tracking-wide text-red-100 uppercase">What to do</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-ink-300">
                <li>
                  If this is the same person, open the existing registration
                  {duplicate.referenceId ? (
                    <>
                      {' '}
                      (<span className="font-mono text-ink-100">{duplicate.referenceId}</span>)
                    </>
                  ) : null}{' '}
                  and enroll or replace the face there.
                </li>
                <li>If this is a different person, retake clearer photos in even light — a blurry or off-angle shot can falsely match someone else.</li>
                <li>If the other ID was enrolled by mistake, clear that person&apos;s face templates first, then enroll here.</li>
              </ul>
              {duplicate.matchedPersonId && (
                <Link
                  href={`/persons/${duplicate.matchedPersonId}`}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-300 underline-offset-2 hover:underline"
                >
                  Open matched registration{duplicate.referenceId ? ` (${duplicate.referenceId})` : ''}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
              {!duplicate.matchedPersonId && duplicate.referenceId && (
                <Link
                  href={`/persons?search=${encodeURIComponent(duplicate.referenceId)}`}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-300 underline-offset-2 hover:underline"
                >
                  Search for {duplicate.referenceId}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
              {duplicate.matchedPersonId && duplicate.matchedFaces?.length ? (
                <div className="pt-1">
                  <p className="mb-2 text-xs text-ink-300">
                    Matching registration{duplicate.matchedPersonName ? `: ${duplicate.matchedPersonName}` : ''}
                    {duplicate.referenceId ? ` (${duplicate.referenceId})` : ''}
                  </p>
                  <EnrolledFaces personId={duplicate.matchedPersonId} templates={duplicate.matchedFaces.map((face) => ({ ...face, modelName: '', modelVersion: '', qualityScore: face.qualityScore ?? null, createdAt: face.createdAt ?? '' }))} highlightId={duplicate.matchedTemplateId} />
                </div>
              ) : null}
              {typeof duplicate.similarity === 'number' && (
                <p className="text-[11px] text-ink-400">
                  Match {Math.round(duplicate.similarity * 100)}%. A second registration is blocked only when the match is 50% or higher.
                  {typeof duplicate.matchedImageIndex === 'number' ? ` Closest photo: image ${duplicate.matchedImageIndex + 1}.` : ''}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {results && (
        <ul className="space-y-2">
          {results.map((r) => (
            <li key={r.index} className="flex items-start gap-3 rounded-lg border border-ink-700 bg-ink-850/60 px-3 py-2.5">
              {r.accepted ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />}
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium text-ink-100">
                  Image {r.index + 1} {r.accepted ? 'accepted' : 'rejected'}
                </p>
                {!r.accepted && (
                  <ul className="mt-0.5 list-disc pl-4 text-xs text-ink-300">
                    {(r.reasons ?? []).map((reason) => (
                      <li key={reason}>{QUALITY_REASON_TEXT[reason] ?? reason}</li>
                    ))}
                    {!r.reasons?.length && r.message && <li>{r.message}</li>}
                  </ul>
                )}
                {r.quality && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge tone={r.quality.score >= 0.6 ? 'green' : 'amber'}>Quality {fmtPercent(r.quality.score)}</Badge>
                    <Badge>Face {Math.round(r.quality.faceSize)} px</Badge>
                    <Badge>Detector {fmtPercent(r.quality.detectionScore)}</Badge>
                    <Badge tone={Math.abs(r.quality.poseYaw) <= 0.25 ? 'neutral' : 'amber'}>{Math.abs(r.quality.poseYaw) <= 0.25 ? 'Frontal pose' : 'Turned pose'}</Badge>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting} disabled={inactive || !images.length} icon={<ScanFace className="h-4 w-4" />}>
          {isSubmitting ? 'Analysing faces…' : `Enroll ${images.length || ''} image${images.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </form>
  );
}

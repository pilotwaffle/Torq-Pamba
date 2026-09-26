import { fieldClass as inputClass } from "@/components/ui";

export type BriefValues = {
  companyName?: string;
  niche?: string;
  whatTheyDo?: string;
  products?: string[];
  audience?: string;
  tone?: string;
  logoUrl?: string;
  websiteUrl?: string;
};

export function BriefFields({
  brief,
  variant,
}: {
  brief: BriefValues;
  variant: "manual" | "confirm" | "edit";
}) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        Company name
        <input
          name="companyName"
          type="text"
          required
          defaultValue={brief.companyName ?? ""}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        Niche
        <input
          name="niche"
          type="text"
          required
          defaultValue={brief.niche ?? ""}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        What you do
        <textarea
          name="whatTheyDo"
          required={variant === "manual"}
          rows={4}
          defaultValue={brief.whatTheyDo ?? ""}
          className={inputClass}
        />
      </label>
      {variant === "manual" ? null : (
        <>
          <label className="flex flex-col gap-1">
            Products
            <textarea
              name="products"
              rows={4}
              defaultValue={(brief.products ?? []).join("\n")}
              className={inputClass}
            />
          </label>
          <p className="-mt-2 text-sm text-zinc-600">One product per line.</p>
          <label className="flex flex-col gap-1">
            Audience
            <input name="audience" type="text" defaultValue={brief.audience ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            Tone
            <input name="tone" type="text" defaultValue={brief.tone ?? ""} className={inputClass} />
          </label>
        </>
      )}
      {variant === "edit" ? (
        <>
          <label className="flex flex-col gap-1">
            Logo URL
            <input name="logoUrl" type="text" defaultValue={brief.logoUrl ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            Website URL
            <input name="websiteUrl" type="text" defaultValue={brief.websiteUrl ?? ""} className={inputClass} />
          </label>
        </>
      ) : null}
    </div>
  );
}

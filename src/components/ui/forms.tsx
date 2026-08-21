export function Input(
  { id, label, type = "text", required = true }: {
    id: string;
    label: string;
    type?: string;
    required?: boolean;
  },
) {
  return (
    <label class="block text-sm" htmlFor={id}>
      <span class="mb-1 block font-semibold">
        {label} {required
          ? <span class="required-mark" aria-label="Pflichtfeld">*</span>
          : <span class="text-meta text-xs font-normal">(optional)</span>}
      </span>
      <input
        class="input-field"
        id={id}
        name={id}
        type={type}
        required={required}
      />
    </label>
  );
}

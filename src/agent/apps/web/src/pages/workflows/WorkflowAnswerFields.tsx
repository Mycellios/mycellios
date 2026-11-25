import { useLingui } from "@lingui/react/macro";
import type { WorkflowAnswerField } from "@mycellios/contracts";
import { Button, Input, NativeSelect, NativeSelectOption } from "@mycellios/ui-web";

export function WorkflowAnswerFields({ fields, disabled, onChange }: {
  fields: readonly WorkflowAnswerField[];
  disabled: boolean;
  onChange: (fields: WorkflowAnswerField[]) => void;
}) {
  const { t } = useLingui();
  const types = [
    ["text", t`Text`], ["number", t`Number`], ["integer", t`Integer`], ["boolean", t`Yes or no`],
    ["list", t`Text list`], ["label", t`Fixed labels`],
  ] as const;

  function replace(index: number, field: WorkflowAnswerField) {
    onChange(fields.map((entry, position) => position === index ? field : entry));
  }

  function add() {
    let number = fields.length + 1;
    while (fields.some(field => field.name === `field${number}`)) number++;
    onChange([...fields, { name: `field${number}`, type: "text" }]);
  }

  return (
    <details className="grid gap-2">
      <summary className="cursor-pointer">{t`Answer fields`}</summary>
      <div className="mt-2 grid gap-3">
        {fields.map((field, index) => (
          <div key={index} className="grid gap-1">
            <label className="grid gap-1">{t`Field name`}
              <Input disabled={disabled} value={field.name} maxLength={48}
                onChange={event => replace(index, { ...field, name: event.currentTarget.value })} />
            </label>
            <label className="grid gap-1">{t`Field type`}
              <NativeSelect disabled={disabled} value={field.type} onChange={event => {
                const selected = types.find(([key]) => key === event.currentTarget.value)?.[0];
                if (!selected) return;
                replace(index, selected === "label" ? { name: field.name, type: selected, labels: ["ready", "review"] } : { name: field.name, type: selected });
              }}>
                {types.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
              </NativeSelect>
            </label>
            {field.type === "label" ? <label className="grid gap-1">{t`Labels, separated by commas`}
              <Input disabled={disabled} maxLength={970} defaultValue={field.labels.join(", ")}
                onBlur={event => replace(index, { ...field, labels: event.currentTarget.value.split(",").map(label => label.trim()).filter(Boolean).slice(0, 12) })} />
            </label> : null}
            <Button size="xs" variant="ghost" className="justify-self-start" disabled={disabled} onClick={() => onChange(fields.filter((_, position) => position !== index))}>{t`Remove field`}</Button>
          </div>
        ))}
        <Button className="justify-self-start" size="xs" variant="outline" disabled={disabled || fields.length >= 12} onClick={add}>{t`Add answer field`}</Button>
      </div>
    </details>
  );
}

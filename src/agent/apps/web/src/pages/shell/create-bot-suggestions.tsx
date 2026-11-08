import { useLingui } from "@lingui/react/macro";
import { MICO_AVATAR_SHAPES, micoAvatarValue } from "@rakazo/contracts";
import { BotAvatar, Button } from "@rakazo/ui-web";
import { useId } from "react";

type SuggestedMico = { name: string; purpose: string; look: string };

function suggestedLook(id: (typeof MICO_AVATAR_SHAPES)[number]["id"]) {
  const { index, originalColor } = MICO_AVATAR_SHAPES.find((shape) => shape.id === id)!;
  return micoAvatarValue(index, originalColor);
}

export function CreateBotSuggestions({ draft, disabled, onSelect, className }: {
  draft: SuggestedMico;
  disabled: boolean;
  onSelect: (suggestion: SuggestedMico) => void;
  className?: string;
}) {
  const { t } = useLingui();
  const id = useId();
  const suggestions = [
    {
      id: "email",
      name: t({ id: "mico-suggestion.email.name", message: "Email assistant" }),
      summary: t({ id: "mico-suggestion.email.summary", message: "Draft replies and keep track of follow-ups." }),
      purpose: t({ id: "mico-suggestion.email.purpose", message: "Help me review my inbox, draft replies and spot messages that need a follow-up." }),
      look: suggestedLook("owl"),
    },
    {
      id: "travel",
      name: t({ id: "mico-suggestion.travel.name", message: "Trip planner" }),
      summary: t({ id: "mico-suggestion.travel.summary", message: "Compare options and build practical itineraries." }),
      purpose: t({ id: "mico-suggestion.travel.purpose", message: "Compare routes, accommodation and budgets, and build practical itineraries for my trips." }),
      look: suggestedLook("moth"),
    },
    {
      id: "organize",
      name: t({ id: "mico-suggestion.organize.name", message: "Personal organizer" }),
      summary: t({ id: "mico-suggestion.organize.summary", message: "Turn notes, errands and tasks into a simple plan." }),
      purpose: t({ id: "mico-suggestion.organize.purpose", message: "Organize my notes, errands and tasks into a clear plan with priorities." }),
      look: suggestedLook("hedgehog"),
    },
    {
      id: "shopping",
      name: t({ id: "mico-suggestion.shopping.name", message: "Shopping assistant" }),
      summary: t({ id: "mico-suggestion.shopping.summary", message: "Compare prices and find options that fit." }),
      purpose: t({ id: "mico-suggestion.shopping.purpose", message: "Compare prices, features and terms before recommending a purchase." }),
      look: suggestedLook("turtle"),
    },
    {
      id: "writing",
      name: t({ id: "mico-suggestion.writing.name", message: "Writing partner" }),
      summary: t({ id: "mico-suggestion.writing.summary", message: "Outline, draft and polish your writing." }),
      purpose: t({ id: "mico-suggestion.writing.purpose", message: "Help me outline, write and revise clear drafts in a tone that fits the audience." }),
      look: suggestedLook("fox"),
    },
    {
      id: "learning",
      name: t({ id: "mico-suggestion.learning.name", message: "Learning coach" }),
      summary: t({ id: "mico-suggestion.learning.summary", message: "Understand new topics and practice at your pace." }),
      purpose: t({ id: "mico-suggestion.learning.purpose", message: "Explain new topics step by step and make short practice exercises suited to my level." }),
      look: suggestedLook("octopus"),
    },
  ];

  return (
    <section aria-labelledby={id} className={className}>
      <h2 id={id} className="mb-1 text-xs font-medium text-muted-foreground">
        {t({ id: "mico-suggestion.heading", message: "Suggestions" })}
      </h2>
      <ul className="rk-scroll -mx-1 flex snap-x gap-2.5 overflow-x-auto overscroll-x-contain px-1 pt-1 pb-2">
        {suggestions.map(({ id: key, name, summary, purpose, look }) => (
          <li key={key} className="w-[min(15rem,85%)] shrink-0 snap-start">
            <Button
              type="button"
              variant="outline"
              className="h-full min-h-24 w-full justify-start gap-3 rounded-xl px-3 py-2.5 text-start whitespace-normal aria-pressed:border-primary aria-pressed:bg-accent"
              aria-label={name}
              aria-describedby={`${id}-${key}`}
              aria-pressed={draft.name === name && draft.purpose === purpose && draft.look === look}
              disabled={disabled}
              onClick={() => onSelect({ name, purpose, look })}
            >
              <BotAvatar color={look} size={40} />
              <span className="grid min-w-0 gap-1">
                <span className="text-sm leading-tight">{name}</span>
                <span id={`${id}-${key}`} className="text-xs leading-snug font-normal text-muted-foreground">{summary}</span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

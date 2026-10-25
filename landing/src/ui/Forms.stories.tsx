import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { AppSelect, Toggle } from "./patterns";
import { Button, Field, FieldLabel, Form, Input, Select, Textarea } from "./primitives";

const meta = { title: "Kit/Forms", component: Input, tags: ["autodocs"] } satisfies Meta<typeof Input>;
export default meta;
type Story = StoryObj<typeof meta>;
export const TextField: Story = { render: () => <Field label="Email" htmlFor="email" hint="Use your account email."><Input id="email" type="email" placeholder="you@example.com" aria-describedby="email-hint" /></Field> };
export const Label: Story = { render: () => <FieldLabel htmlFor="label-example">Account email <Input id="label-example" type="email" /></FieldLabel> };
export const Error: Story = { render: () => <Field label="Email" htmlFor="invalid-email" error="Enter a valid email address."><Input id="invalid-email" type="email" defaultValue="invalid" aria-invalid="true" aria-describedby="invalid-email-error" /></Field> };
export const Disabled: Story = { args: { disabled: true, placeholder: "Unavailable" } };
export const Password: Story = { args: { type: "password", "aria-label": "Password", defaultValue: "example" } };
export const Multiline: Story = { render: () => <Field label="Instructions" htmlFor="instructions"><Textarea id="instructions" rows={4} placeholder="Describe the task" /></Field> };
export const NativeSelect: Story = { render: () => <Field label="Power" htmlFor="power"><Select id="power"><option>Balanced</option><option>Low</option><option>Maximum</option></Select></Field> };
export const CheckboxAndRange: Story = { render: () => <div style={{ display: "grid", gap: 20 }}><Input type="checkbox" aria-label="Remember device" /><Input type="range" aria-label="Power limit" min={0} max={100} defaultValue={50} /></div> };
export const CustomSelect: Story = { render: function Demo() { const [value, setValue] = useState("balanced"); return <AppSelect ariaLabel="Power mode" value={value} onChange={setValue} options={[{ value: "low", label: "Low" }, { value: "balanced", label: "Balanced" }, { value: "maximum", label: "Maximum" }]} />; } };
export const Switch: Story = { render: function Demo() { const [checked, setChecked] = useState(false); return <Toggle label="Contribute compute" checked={checked} onChange={setChecked} />; } };
export const AccountForm: Story = { render: () => <Form onSubmit={event => event.preventDefault()} style={{ display: "grid", gap: 20, maxWidth: 420 }}><Field label="Email" htmlFor="account-email"><Input id="account-email" type="email" required autoComplete="email" /></Field><Field label="Password" htmlFor="account-password"><Input id="account-password" type="password" required autoComplete="current-password" /></Field><Button type="submit" variant="primary">Sign in securely</Button></Form> };

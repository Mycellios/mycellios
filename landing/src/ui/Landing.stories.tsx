import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentPreview, ModernLanding } from "../rebrand/ModernLanding";
import { RootedLanding, ApiSample } from "../rebrand/RootedLanding";
import { NetworkWeave } from "../rebrand/NetworkWeave";
import { AssemblageLanding } from "../rebrand/AssemblageLanding";
import { ReferenceLanding } from "../rebrand/ReferenceLanding";

const meta = { title: "Screens/Landing", component: ReferenceLanding, parameters: { layout: "fullscreen", ownsThemeRoot: true } } satisfies Meta<typeof ReferenceLanding>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Refreshed: Story = {};
export const WithMushrooms: Story = { args: { initialArtwork: "fruiting" } };
export const MushroomComparison: Story = { args: { initialArtwork: "fruiting", compareArtwork: true } };
export const DiscardedAssemblage: Story = { render: () => <AssemblageLanding /> };
export const PreviousRooted: Story = { render: () => <RootedLanding /> };
export const SavedVersion: Story = { render: () => <ModernLanding /> };
export const NetworkConcept: Story = { render: () => <section className="mycellios-rooted" style={{ maxWidth: 700, padding: 32 }}><NetworkWeave /></section> };
export const ApiEndpoint: Story = { render: () => <section className="mycellios-rooted rooted-network" style={{ padding: 32 }}><ApiSample /></section> };
export const AgentInterface: Story = { render: () => <section className="mycellios-home" style={{ padding: 24 }}><AgentPreview /></section> };

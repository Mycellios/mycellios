import type { Meta, StoryObj } from "@storybook/react-vite";
import { AssemblageHero, AssemblageLanding } from "../rebrand/AssemblageLanding";
import { AssemblageAgent } from "../rebrand/AssemblageAgent";
import { AssemblageApi, AssemblageNetwork } from "../rebrand/AssemblageNetwork";

const meta = { title: "Screens/Assemblage landing", component: AssemblageLanding, parameters: { layout: "fullscreen", ownsThemeRoot: true } } satisfies Meta<typeof AssemblageLanding>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Complete: Story = {};
export const Hero: Story = { render: () => <main className="mycellios-assemblage"><AssemblageHero /></main> };
export const AgentWorkspace: Story = { render: () => <section className="mycellios-assemblage" style={{ padding: 24 }}><AssemblageAgent /></section> };
export const NetworkConcept: Story = { render: () => <section className="mycellios-assemblage" style={{ padding: 24, maxWidth: 700 }}><AssemblageNetwork /></section> };
export const ApiEndpoint: Story = { render: () => <section className="mycellios-assemblage" style={{ padding: 24, maxWidth: 600 }}><AssemblageApi /></section> };

/** Product identity shared by browser and native clients of this fork. */
export const productBrand = {
  name: "Mycellios Agent",
  shortName: "Mycellios",
  companionName: "Mico",
  companionPlural: "Micos",
  tokenName: "Spore",
  creditName: "Credits",
  apiBaseUrl: "https://www.mycellios.com/v1",
  apiHosts: ["www.mycellios.com", "mycellios.com"],
  mascotPath: "/mycellios/mico.png",
  mascotAnimationPath: "/mycellios/mico-idle.webp",
  markPath: "/mycellios/mark.png",
} as const;

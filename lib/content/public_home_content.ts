export interface PublicHomeContent {
  intro: {
    kicker: string;
    titlePrefix: string;
    description: string;
    primaryCtaLabel: string;
    primaryCtaHref: string;
  };
  coursesIntro: {
    kicker: string;
    title: string;
    description: string;
    emptyState: string;
  };
}

export const publicHomeContent: PublicHomeContent = {
  intro: {
    kicker: "Kursportal",
    titlePrefix: "Willkommen beim Kursangebot der",
    description:
      "Übersicht über unsere aktuell angebotenen Kurse und Termine. Wählen Sie einen passenden Kurs aus und melden Sie sich direkt online an.",
    primaryCtaLabel: "Kurs finden",
    primaryCtaHref: "#aktive-kurse",
  },
  coursesIntro: {
    kicker: "Kursangebot",
    title: "Aktuelles Kursangebot",
    description:
      "Wählen Sie einen Termin aus und sichern Sie sich ihren Platz.",
    emptyState: "Aktuell werden keine Kurse angeboten.",
  },
};

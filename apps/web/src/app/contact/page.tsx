import { contactPage } from "@/lib/contact";
import { ContactForm } from "./contact-form";

export const metadata = {
  title: "Contact — Alembic",
  description: "Questions, problems, workshops or using Alembic at your institution: write to the people who run Alembic.",
};

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }) {
  const { from } = await searchParams;
  const page = contactPage(Array.isArray(from) ? from[0] : from);
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
      <h1 className="font-serif text-3xl tracking-tight text-ink">Contact us</h1>
      <p className="mt-2 text-muted">
        A question, something that isn&apos;t working, a workshop, or using Alembic at your school? Write to us and we&apos;ll
        reply by email.
      </p>
      <ContactForm page={page} />
    </main>
  );
}

// «Defensa de código»: before the first question, the student loads their code. If they do not have
// it at hand, the teacher can load it from their screen and this step goes on by itself.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { CodeInput, codeFilesToSend } from "@client/components/app/code-input";
import { ApiError } from "@client/lib/api";
import type { CodeFile } from "@shared/domain/code-defense";
import type { StudentWorkspace } from "@shared/contracts/student";
import { setWorkspace, studentApi } from "./api";
import { useT } from "./i18n";

export function CodeStep({ token, workspace }: { token: string; workspace: StudentWorkspace }) {
  const t = useT();
  const qc = useQueryClient();
  const [files, setFiles] = useState<CodeFile[]>([]);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toSend = codeFilesToSend(files, pasted);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await studentApi.saveCode(token, toSend);
      setWorkspace(qc, token, res.workspace);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.chat.sendFailed);
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="code-title" className="rounded-xl border border-line bg-surface p-5 shadow-1">
      <h2 id="code-title" className="font-display text-xl font-semibold text-ink">
        {t.code.title(workspace.activity.subject)}
      </h2>
      <p className="mt-1 mb-4 text-[15px] leading-6 text-text-2">{t.code.intro}</p>
      <CodeInput
        files={files}
        onFiles={setFiles}
        pasted={pasted}
        onPasted={setPasted}
        labels={{ files: t.code.files, lines: t.code.lines, paste: t.code.paste, placeholder: t.code.placeholder, remove: t.code.remove }}
      />
      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-rose">
          {error}
        </p>
      ) : null}
      <Button className="mt-4 w-full sm:w-auto" disabled={!toSend.length} loading={busy} icon={<ArrowRight className="size-4" />} onClick={() => void submit()}>
        {t.code.submit}
      </Button>
      <p className="mt-3 text-[13px] leading-5 text-text-3">{t.code.noCode}</p>
    </section>
  );
}

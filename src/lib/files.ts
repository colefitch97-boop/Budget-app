interface DownloadsCap {
  save(req: { filename: string; data: string | Blob }): Promise<{ status: string }>;
}

/**
 * Offers a file to save. Inside claude.ai the page can't start downloads
 * itself, so it asks the viewer through the `downloads` capability;
 * anywhere else it uses an ordinary download link.
 */
export async function saveFile(filename: string, data: string, mime: string): Promise<'saved' | 'declined' | 'failed'> {
  const runtime = (globalThis as unknown as { claude?: { use(name: string): Promise<unknown> } }).claude;
  if (runtime?.use) {
    const downloads = (await runtime.use('downloads').catch(() => null)) as DownloadsCap | null;
    if (downloads) {
      try {
        await downloads.save({ filename, data });
        return 'saved';
      } catch (e) {
        return (e as { code?: string })?.code === 'declined' ? 'declined' : 'failed';
      }
    }
  }
  try {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = String(v);
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}

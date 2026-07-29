# Source-system logos

Drop official logo files here and the sign-in orbits pick them up. **No code
change, no rebuild wiring** — the file name is the whole contract.

## The names

| File | Chip |
| --- | --- |
| `fabric.svg` | Microsoft Fabric |
| `onelake.svg` | OneLake |
| `excel.svg` | Excel |
| `yardi.svg` | Yardi |
| `apx.svg` | Advent Portfolio Exchange |
| `kdb.svg` | kdb+ |

`.png` works too — try `.svg` first, since these are drawn small and again at 2x
on a retina screen, and a raster logo goes soft at exactly the size a login
screen is looked at.

**Give the file its real extension.** A PNG saved as `.svg` does not render:
the browser is told `image/svg+xml` by the server and gets PNG bytes. That is
how `Fabric_final_x256.svg` arrived here — a 256×256 PNG — and it is now
`fabric.png`.

Square icon or wide wordmark, either is fine. The chip measures the file when
it loads and becomes a circle or a pill accordingly, so you do not have to say
which you dropped in.

## What happens if a file is missing

Nothing breaks. Each chip falls back in order:

1. the file here, if it loads;
2. the hand-drawn mark in `src/auth/SourceMarks.tsx`, for the three that have
   one (Fabric, OneLake, Excel);
3. the system's name as a text pill.

That is why the orbits work today with an empty folder, and why adding one file
changes exactly one chip.

## Why they are not committed already

These are other companies' trademarks. Redrawing one from memory produces
something subtly wrong, and a subtly wrong logo is a false claim about someone
else's brand — worse than simply naming them. Hot-linking a CDN was the other
option and is worse still: a third-party request on the one screen where a
person is deciding whether to trust this app, with a chance to hang while they
wait.

Using a vendor's own published mark to identify that vendor is ordinary
nominative use. Get the file from the source's brand page — Microsoft publishes
Fabric and Office assets, and the others have press or brand kits — and put it
here.

## Where to find them

- **Fabric / OneLake / Excel** — Microsoft brand and product icon downloads.
- **Yardi, Advent Portfolio Exchange (SS&C), kdb+ (KX)** — each vendor's press
  or brand-assets page.

Keep the original file rather than an export from a screenshot: an SVG traced
off a bitmap carries the bitmap's errors and is the thing that looks cheap at
2x.

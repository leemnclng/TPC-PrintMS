# Windows Installation and Hardware Setup

Use this checklist when preparing a Windows workstation for Printing-MS. The
application installer and the printer/scanner driver are separate packages.

## Required Software

1. Install Printing-MS.
2. Install the current Canon driver package for the exact printer model. On the
   validated Canon workstation, installing the **IJPAT driver/package** made the
   scanner available to Printing-MS through Windows Image Acquisition (WIA).
3. Restart Windows after installing or repairing the Canon package.
4. For development installations only, install Node.js 20+, npm, and `uv`, then
   use `scripts\run.bat`. A production installer must bundle its runtime and must
   not require these developer tools.

Always obtain the Canon package from Canon's support page for the exact model
and Windows version. Do not redistribute a vendor driver inside the Printing-MS
installer unless its license explicitly permits it.

## Canon Network Scanner Setup

For a Canon device connected over Wi-Fi or Ethernet:

1. Connect the computer and printer to the same reachable network.
2. Open **Canon Utilities > IJ Network Scanner Selector EX2** when installed.
3. Enable the utility and select the printer under **Scan-from-PC Settings**.
4. Allow Canon utilities and Printing-MS through Windows Firewall on the local
   network when Windows prompts.

USB installations normally do not need the network selector, but still require
the Canon package that registers the WIA scanner.

## Acceptance Check

Complete these checks before using the workstation for production:

- Windows **Printers & scanners** lists the device.
- A test page prints through the installed Windows queue.
- The Windows **Scan** application can see and acquire from the scanner.
- Printing-MS Scan intake lists the scanner after **Refresh devices**.
- Test one flatbed page and, when supported, one feeder page.
- Confirm the acquired page is previewed and retained in the job order.

Canon PRINT being able to scan is not sufficient by itself. Canon PRINT may use
Canon's own discovery stack, while Printing-MS enumerates WIA devices. If Canon
PRINT works but Windows Scan and Printing-MS do not, install or repair the
IJPAT/full Canon MP/WIA driver package and reselect the network scanner.

## Installer Requirements

The future Windows setup should:

- run a prerequisite check for a WIA scanner without blocking installation;
- explain that Canon IJPAT/full MP/WIA drivers are installed separately;
- provide the driver/setup checklist above when no WIA scanner is found;
- preserve the selected environment database and managed-file directories on
  upgrades;
- bundle the desktop app and backend runtime;
- include the scanner PowerShell resource used by the Electron package; and
- offer a post-install hardware verification screen for printer discovery,
  scanner discovery, a test print, and a test scan.

Do not silently install or update printer drivers. The owner should choose the
model-specific package and approve vendor installation prompts.

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Canon PRINT scans, but Printing-MS reports no scanner | Canon software can reach the device, but no WIA scanner is registered | Install/repair IJPAT or the full Canon MP/WIA package, restart Windows, then test with Windows Scan |
| Network scanner is absent | Scan-from-PC device is not selected | Configure IJ Network Scanner Selector EX2 |
| Scanner appears offline | Device, USB, network, firewall, or driver communication failure | Confirm power/connection, close other scan apps, then refresh |
| Scanner is visible but acquisition fails | Device is busy or reports paper, cover, or feeder state | Follow the Printing-MS readiness message and retry |


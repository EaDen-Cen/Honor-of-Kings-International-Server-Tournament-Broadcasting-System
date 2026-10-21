# A Windows job owns this launcher and ONLY descendants created in this launch.
# The kernel closes the job when the console/process exits, even if PowerShell
# finally blocks cannot run. Already-running HOK sessions are not in this job.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class HokLauncherJob {
    [StructLayout(LayoutKind.Sequential)] struct Basic {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct Io {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct Extended {
        public Basic Basic;
        public Io Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref Extended info, uint length);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    // Keep the handle until OS process teardown; do not expose it to children.
    static IntPtr job;
    public static void Attach() {
        job = CreateJobObject(IntPtr.Zero, null);
        if(job == IntPtr.Zero) throw new Win32Exception();
        var info = new Extended(); info.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE
        if(!SetInformationJobObject(job, 9, ref info, (uint)Marshal.SizeOf(info)) ||
           !AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle)) {
            int error=Marshal.GetLastWin32Error(); CloseHandle(job);
            throw new Win32Exception(error);
        }
    }
}
'@
[HokLauncherJob]::Attach()
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
# This BAT has no path enumeration or generated file operations. It is the
# existing UI/health flow, now contained by an OS-owned lifetime boundary.
& $env:ComSpec /d /c 'start-broadcast.bat --managed-session'
exit $LASTEXITCODE

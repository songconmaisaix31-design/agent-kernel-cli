using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public sealed class KernelJobResult {
    public string reason;
    public long exitCode = -1;
    public bool verified;
    public uint remaining;
    public string detail;
}

public static class KernelJob {
    [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {
        public int length; public IntPtr descriptor; public int inherit;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct StartupInfo {
        public int cb; public string reserved; public string desktop; public string title;
        public uint x, y, xSize, ySize, xCount, yCount, fill, flags;
        public short show, reservedSize; public IntPtr reservedBytes, stdin, stdout, stderr;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
        public IntPtr process, thread; public uint processId, threadId;
    }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long processTime, jobTime; public uint flags; public UIntPtr minimum, maximum;
        public uint active; public UIntPtr affinity; public uint priority, scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits basic; public IoCounters io;
        public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long userTime, kernelTime, periodUser, periodKernel;
        public uint pageFaults, total, active, terminated;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out Accounting info, uint length, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateFile(string name, uint access, uint share, ref SecurityAttributes attributes,
        uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes,
        IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory,
        ref StartupInfo startup, out ProcessInfo process);

    static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static IntPtr Open(string path, bool input) {
        var attributes = new SecurityAttributes { length = Marshal.SizeOf(typeof(SecurityAttributes)), inherit = 1 };
        var handle = CreateFile(path, input ? 0x80000000u : 0x40000000u, 7, ref attributes, input ? 3u : 2u, 0x80, IntPtr.Zero);
        Check(handle != new IntPtr(-1));
        return handle;
    }
    static string Quote(string value) {
        var output = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') output.Append('\\', slashes * 2 + 1).Append(c);
            else output.Append('\\', slashes).Append(c);
            slashes = 0;
        }
        return output.Append('\\', slashes * 2).Append('"').ToString();
    }
    static uint Active(IntPtr job) {
        Accounting info;
        Check(QueryInformationJobObject(job, 1, out info, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
        return info.active;
    }
    public static KernelJobResult Run(string executable, string[] args, string cwd, string stdinPath,
        string stdoutPath, string stderrPath, int timeoutMs, long outputLimitBytes) {
        var result = new KernelJobResult { reason = "launch_failed" };
        IntPtr job = IntPtr.Zero, input = IntPtr.Zero, output = IntPtr.Zero, error = IntPtr.Zero;
        var process = new ProcessInfo();
        bool assigned = false;
        try {
            job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
            var limits = new ExtendedLimits();
            limits.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE, without breakaway permission.
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))));
            input = Open(stdinPath, true); output = Open(stdoutPath, false); error = Open(stderrPath, false);
            var startup = new StartupInfo {
                cb = Marshal.SizeOf(typeof(StartupInfo)), flags = 0x100,
                stdin = input, stdout = output, stderr = error
            };
            var command = new StringBuilder(Quote(executable));
            foreach (string argument in args) command.Append(' ').Append(Quote(argument));
            // Assignment precedes the first instruction, so early children cannot escape ownership.
            Check(CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x08000004,
                IntPtr.Zero, cwd, ref startup, out process));
            Check(AssignProcessToJobObject(job, process.process)); assigned = true;
            Check(ResumeThread(process.thread) != 0xffffffff);
            Console.Out.WriteLine("{\"type\":\"started\",\"pid\":" + process.processId + "}");
            Console.Out.Flush();
            var request = System.Threading.Tasks.Task.Run(() => Console.In.ReadLine());
            var clock = Stopwatch.StartNew();
            result.reason = "completed";
            while (true) {
                uint waited = WaitForSingleObject(process.process, 0);
                if (waited == 0) break;
                Check(waited == 258);
                if (request.IsCompleted) {
                    result.reason = request.Result == null ? "owner_lost" : "stopped";
                    break;
                }
                if (clock.ElapsedMilliseconds >= timeoutMs) { result.reason = "timed_out"; break; }
                if (new FileInfo(stdoutPath).Length + new FileInfo(stderrPath).Length > outputLimitBytes) {
                    result.reason = "output_limit"; break;
                }
                Thread.Sleep(50);
            }
            if (result.reason == "completed") {
                uint code; Check(GetExitCodeProcess(process.process, out code)); result.exitCode = code;
            }
        } catch (Exception exception) {
            result.reason = "launch_failed"; result.detail = exception.Message;
        } finally {
            try {
                if (process.process != IntPtr.Zero && !assigned) {
                    Check(TerminateProcess(process.process, 1));
                    Check(WaitForSingleObject(process.process, 5000) == 0);
                }
                if (job != IntPtr.Zero) {
                    Check(TerminateJobObject(job, 1));
                    var stopClock = Stopwatch.StartNew();
                    while (Active(job) != 0 && stopClock.ElapsedMilliseconds < 5000) Thread.Sleep(25);
                    result.remaining = Active(job);
                    result.verified = result.remaining == 0;
                } else result.verified = process.process == IntPtr.Zero;
            } catch (Exception exception) { result.detail = exception.Message; result.verified = false; }
            foreach (var handle in new[] { process.thread, process.process, input, output, error, job }) {
                if (handle != IntPtr.Zero && handle != new IntPtr(-1)) CloseHandle(handle);
            }
        }
        return result;
    }
}

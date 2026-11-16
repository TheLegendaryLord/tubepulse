using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

internal static class LiteLauncher
{
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length == 0 || !Regex.IsMatch(args[0], @"\Achrome-extension://[a-p]{32}/\z"))
                throw new ArgumentException("Chrome origin does not match a Chrome extension.");

            var root = AppDomain.CurrentDomain.BaseDirectory;
            var node = File.ReadAllText(Path.Combine(root, "node-path.txt"));
            if (!Regex.IsMatch(node, @"\A[A-Za-z]:\\") ||
                !string.Equals(Path.GetFileName(node), "node.exe", StringComparison.OrdinalIgnoreCase) ||
                !File.Exists(node))
                throw new FileNotFoundException("The configured Node.js executable is missing. Rerun setup.");

            // The script path is a Windows filename, and the origin matches the fixed grammar above.
            var start = new ProcessStartInfo(node, "\"" + Path.Combine(root, "tubepulse.cjs") + "\" " + args[0]);
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WorkingDirectory = root;
            start.RedirectStandardInput = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.EnvironmentVariables.Remove("NODE_OPTIONS");
            start.EnvironmentVariables.Remove("NODE_PATH");
            using (var process = Process.Start(start))
            {
                CopyInput(process.StandardInput.BaseStream);
                var stdout = process.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
                var stderr = process.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
                process.WaitForExit();
                Task.WaitAll(stdout, stderr);
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("TubePulse: " + error.Message);
            return 1;
        }
    }

    private static async void CopyInput(Stream destination)
    {
        using (destination)
        {
            try { await Console.OpenStandardInput().CopyToAsync(destination); }
            catch (IOException) { } // Browser or child closed its pipe.
            catch (ObjectDisposedException) { }
        }
    }
}

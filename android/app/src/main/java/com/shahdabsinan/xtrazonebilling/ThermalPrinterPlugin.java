package com.shahdabsinan.xtrazonebilling;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "ThermalPrinter")
public class ThermalPrinterPlugin extends Plugin {

    private static final int CONNECT_TIMEOUT_MS = 5000;

    @PluginMethod
    public void printRaw(PluginCall call) {
        String ip = call.getString("ip");
        int port = call.getInt("port", 9100);
        String data = call.getString("data");

        if (ip == null || ip.trim().isEmpty()) {
            call.reject("Printer IP is required");
            return;
        }
        if (data == null) {
            call.reject("Print data is required");
            return;
        }

        new Thread(() -> {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(ip, port), CONNECT_TIMEOUT_MS);
                OutputStream out = socket.getOutputStream();
                out.write(data.getBytes(StandardCharsets.UTF_8));
                out.flush();

                JSObject result = new JSObject();
                result.put("success", true);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Printer connection failed: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void testConnection(PluginCall call) {
        String ip = call.getString("ip");
        int port = call.getInt("port", 9100);

        if (ip == null || ip.trim().isEmpty()) {
            call.reject("Printer IP is required");
            return;
        }

        new Thread(() -> {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(ip, port), CONNECT_TIMEOUT_MS);
                JSObject result = new JSObject();
                result.put("success", true);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Printer not reachable: " + e.getMessage(), e);
            }
        }).start();
    }
}

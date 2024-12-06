from splitflap_proto import splitflap_context, ask_for_serial_port
import time

def monitor_home(message):
    current_time = time.time()
    for i, module in enumerate(message.modules):
        if module.sensor_state:  # True when magnet is detected
            print(f"[{current_time:.3f}] Module {i}: HOME detected at flap {module.flap_index}")

def main():
    port = ask_for_serial_port()
    with splitflap_context(port) as s:
        s.add_handler('splitflap_state', monitor_home)
        print("Monitoring home sensors. Press Ctrl+C to exit.")
        try:
            while True:
                s.request_state()
                time.sleep(0.1)
        except KeyboardInterrupt:
            pass

if __name__ == '__main__':
    main()
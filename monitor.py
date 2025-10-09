#!/usr/bin/env python3
import subprocess
import time
from datetime import datetime
import csv
import os
import re

try:
    from PIL import Image
    import pytesseract
except ImportError:
    print("需要安装依赖:")
    print("pip install pillow pytesseract")
    print("brew install tesseract  # macOS")
    exit(1)

class ScreenMonitor:
    def __init__(self, csv_file='spam_calls_record.csv'):
        self.csv_file = csv_file
        self.screenshot_file = '/tmp/screen.png'
        self.initialize_csv()
        
    def initialize_csv(self):
        if not os.path.exists(self.csv_file):
            with open(self.csv_file, 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['Number', 'Label', 'Date', 'Time'])
            print(f"创建 CSV: {self.csv_file}")
    
    def take_screenshot(self):
        """截屏"""
        subprocess.run(['adb', 'exec-out', 'screencap', '-p'], 
                      stdout=open(self.screenshot_file, 'wb'), 
                      stderr=subprocess.DEVNULL)
    
    def extract_text_from_screen(self):
        """OCR 识别屏幕文字"""
        try:
            img = Image.open(self.screenshot_file)
            text = pytesseract.image_to_string(img)
            return text
        except Exception as e:
            return ""
    
    def detect_call_and_label(self, text):
        """检测是否在通话中，以及标签"""
        text_lower = text.lower()
        
        # 检测是否在通话界面
        if not any(word in text_lower for word in 
                   ['calling', 'incoming', 'call', '来电', '通话']):
            return None, None
        
        # 提取电话号码
        phone_match = re.search(r'[\+\d][\d\s\-\(\)]{9,}', text)
        phone = phone_match.group(0).strip() if phone_match else None
        
        # 检测标签
        if 'scam likely' in text_lower or 'scam' in text_lower:
            label = 'Scam Likely'
        elif 'telemarketing' in text_lower or 'telemarket' in text_lower:
            label = 'Telemarketing'
        elif 'spam' in text_lower:
            label = 'Spam'
        else:
            label = 'Regular'
        
        return phone, label
    
    def record_call(self, number, label):
        """记录到 CSV"""
        now = datetime.now()
        date = now.strftime('%Y-%m-%d')
        time_str = now.strftime('%H:%M:%S')
        
        with open(self.csv_file, 'a', newline='') as f:
            writer = csv.writer(f)
            writer.writerow([number, label, date, time_str])
        
        print(f"\n记录: {number} - {label} ({date} {time_str})")
    
    def start_monitoring(self):
        print("=" * 60)
        print("屏幕监控模式 - OCR 识别")
        print("每秒截屏并识别文字")
        print("按 Ctrl+C 停止")
        print("=" * 60)
        
        recorded = set()
        
        try:
            while True:
                self.take_screenshot()
                text = self.extract_text_from_screen()
                
                if text:
                    phone, label = self.detect_call_and_label(text)
                    
                    if phone and phone not in recorded:
                        print(f"检测到通话: {phone} - {label}")
                        self.record_call(phone, label)
                        recorded.add(phone)
                
                time.sleep(1)  # 每秒检查一次
                
        except KeyboardInterrupt:
            print("\n\n监控停止")

if __name__ == '__main__':
    monitor = ScreenMonitor()
    monitor.start_monitoring()
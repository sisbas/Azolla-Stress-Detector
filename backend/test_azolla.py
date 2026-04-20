"""
Azolla Pipeline Test Suite

Bu modül, AzollaPipeline'ın farklı senaryolar için testlerini içerir.
"""

import unittest
import numpy as np
import cv2
from azolla_analyzer import AzollaPipeline, StressLevel


class TestAzollaPipeline(unittest.TestCase):
    """AzollaPipeline testleri"""
    
    def setUp(self):
        """Test öncesi hazırlık"""
        self.pipeline = AzollaPipeline()
        
        # Yeşil ağırlıklı test görüntüsü (sağlıklı Azolla simülasyonu)
        self.healthy_image = np.zeros((100, 100, 3), dtype=np.uint8)
        self.healthy_image[:, :] = [50, 180, 50]  # BGR: Yeşil
        
        # Sarı/kahverengi test görüntüsü (stresli Azolla simülasyonu)
        self.stressed_image = np.zeros((100, 100, 3), dtype=np.uint8)
        self.stressed_image[:, :] = [40, 100, 100]  # BGR: Sarımsı
    
    def test_healthy_azolla_detection(self):
        """Sağlıklı Azolla tespiti testi"""
        result = self.pipeline.process(self.healthy_image)
        
        self.assertTrue(result.segmentation.is_valid)
        self.assertGreater(result.segmentation.coverage_ratio, 0.5)
        # Stres seviyesi NORMAL veya LOW olabilir (yüksek yeşil değer)
        self.assertIn(result.stress_level, [StressLevel.NORMAL, StressLevel.LOW, StressLevel.MEDIUM])
        self.assertIsNotNone(result.features)
        
        if result.features:
            # Sağlıklı Azolla yüksek G/R oranına sahip olmalı
            self.assertLess(result.features.rg_ratio, 0.6)
            # Yüksek yeşil değeri
            self.assertGreater(result.features.g_norm, 0.3)
    
    def test_stressed_azolla_detection(self):
        """Stresli Azolla tespiti testi"""
        result = self.pipeline.process(self.stressed_image)
        
        # Stresli görüntüde daha düşük coverage veya stres beklenir
        self.assertIsNotNone(result.stress_score)
    
    def test_glare_detection(self):
        """Glare (parlama) tespiti testi"""
        # Parlak beyaz görüntü
        glare_image = np.full((100, 100, 3), 250, dtype=np.uint8)
        
        result = self.pipeline.process(glare_image)
        
        # Yüksek glare yüzdesi beklenir
        self.assertGreater(result.glare_pct, 50.0)
    
    def test_empty_image(self):
        """Boş/siyah görüntü testi"""
        empty_image = np.zeros((100, 100, 3), dtype=np.uint8)
        
        result = self.pipeline.process(empty_image)
        
        # Geçersiz segmentasyon beklenir
        self.assertFalse(result.segmentation.is_valid)
        self.assertIsNone(result.features)
    
    def test_metadata_extraction(self):
        """Metadata çıkarma testi"""
        image = np.random.randint(0, 255, (240, 320, 3), dtype=np.uint8)
        
        result = self.pipeline.process(image)
        
        self.assertEqual(result.metadata['width'], 320)
        self.assertEqual(result.metadata['height'], 240)
        self.assertEqual(result.metadata['channels'], 3)
    
    def test_output_images(self):
        """Çıktı görüntüleri testi"""
        image = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8)
        
        result = self.pipeline.process(image)
        
        self.assertIsNotNone(result.processed_image)
        self.assertIsNotNone(result.mask_image)
        self.assertIsNotNone(result.hsv_image)
        
        # Görüntü boyutları kontrolü
        self.assertEqual(result.processed_image.shape[:2], (100, 100))
        self.assertEqual(result.mask_image.shape[:2], (100, 100))
        self.assertEqual(result.hsv_image.shape[:2], (100, 100))
    
    def test_stress_levels(self):
        """Farklı stres seviyeleri testi"""
        # Normal görüntü
        normal_image = np.zeros((100, 100, 3), dtype=np.uint8)
        normal_image[:, :] = [50, 180, 50]
        
        result = self.pipeline.process(normal_image)
        # Yeşil ağırlıklı görüntüler NORMAL, LOW veya MEDIUM olabilir
        self.assertIn(result.stress_level, [StressLevel.NORMAL, StressLevel.LOW, StressLevel.MEDIUM])
    
    def test_feature_extraction(self):
        """Özellik çıkarma testi"""
        image = np.zeros((100, 100, 3), dtype=np.uint8)
        image[:, :] = [50, 180, 50]
        
        result = self.pipeline.process(image)
        
        if result.features:
            # Tüm özelliklerin mevcut olması gerekir
            self.assertIsNotNone(result.features.timestamp)
            self.assertIsNotNone(result.features.coverage)
            self.assertIsNotNone(result.features.mean_r)
            self.assertIsNotNone(result.features.mean_g)
            self.assertIsNotNone(result.features.mean_b)
            self.assertIsNotNone(result.features.rg_ratio)
            self.assertIsNotNone(result.features.g_norm)
            self.assertIsNotNone(result.features.rgri)
            self.assertIsNotNone(result.features.skew_g)
            self.assertIsNotNone(result.features.kurt_g)


if __name__ == '__main__':
    unittest.main()

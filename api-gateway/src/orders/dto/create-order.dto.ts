import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsArray,
  ValidateNested,
  IsNumber,
  IsPositive,
  IsOptional,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OrderItemDto {
  @IsString()
  @IsNotEmpty({ message: 'Product ID is required' })
  productId: string;

  @IsString()
  @IsNotEmpty({ message: 'Product name is required' })
  productName: string;

  @IsNumber()
  @IsPositive({ message: 'Quantity must be a positive number' })
  @Min(1, { message: 'Quantity must be at least 1' })
  quantity: number;

  @IsNumber()
  @IsPositive({ message: 'Unit price must be a positive number' })
  unitPrice: number;
}

export class DeliveryAddressDto {
  @IsString()
  @IsNotEmpty({ message: 'Street address is required' })
  street: string;

  @IsString()
  @IsNotEmpty({ message: 'City is required' })
  city: string;

  @IsString()
  @IsNotEmpty({ message: 'Postal code is required' })
  postalCode: string;

  @IsString()
  @IsNotEmpty({ message: 'Country is required' })
  country: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;
}

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty({ message: 'Customer ID is required' })
  customerId: string;

  @IsString()
  @IsNotEmpty({ message: 'Customer name is required' })
  customerName: string;

  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty({ message: 'Customer email is required' })
  customerEmail: string;

  @IsArray({ message: 'Items must be an array' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress: DeliveryAddressDto;
}
